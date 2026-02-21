import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as http from "node:http";
import { WebSocket } from "ws";
import {
  createServer,
  createWebSocketServer,
  createWebSocketHandler,
  createInMemoryChatStorage,
} from "./index.js";
import { MSG_JOIN_ROOM, MSG_ROOM_JOINED, MSG_SEND_CHAT, MSG_CHAT_MESSAGE } from "./protocol.js";

describe("WebSocket server integration", () => {
  let server: http.Server;
  let port: number;
  const path = "/live";

  beforeAll(async () => {
    const storage = createInMemoryChatStorage({ historyLimit: 10 });
    server = http.createServer((_req, res) => {
      res.writeHead(200);
      res.end();
    });
    createWebSocketServer(server, {
      path,
      chat: { storage, historyLimit: 10 },
    });
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        port = typeof addr === "object" && addr && "port" in addr ? addr.port : 0;
        resolve();
      });
    });
  });

  afterAll(() => {
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("responds to join_room with room_joined", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    const messages: unknown[] = [];
    ws.on("message", (data) => messages.push(JSON.parse(data.toString())));

    await new Promise<void>((resolve) => {
      ws.on("open", () => {
        ws.send(
          JSON.stringify({
            type: MSG_JOIN_ROOM,
            payload: { roomId: "test-room", presence: { name: "alice" } },
          })
        );
        const check = (): void => {
          const roomJoined = messages.find((m: { type?: string }) => m?.type === MSG_ROOM_JOINED);
          if (roomJoined) {
            resolve();
            return;
          }
          setTimeout(check, 20);
        };
        setTimeout(check, 50);
      });
    });

    const roomJoined = messages.find((m: { type?: string }) => m?.type === MSG_ROOM_JOINED) as {
      type: string;
      payload: {
        roomId: string;
        connectionId: string;
        presence: Record<string, { connectionId: string; presence?: unknown }>;
      };
    };
    expect(roomJoined).toBeDefined();
    expect(roomJoined.payload.roomId).toBe("test-room");
    expect(roomJoined.payload.connectionId).toBeDefined();
    const presenceEntries = Object.values(roomJoined.payload.presence);
    expect(presenceEntries.length).toBe(1);
    expect(presenceEntries[0].connectionId).toBe(roomJoined.payload.connectionId);

    ws.close();
  });

  it("broadcasts chat to same room", async () => {
    const storage = createInMemoryChatStorage({ historyLimit: 10 });
    const srv = http.createServer((_req, res) => {
      res.writeHead(200);
      res.end();
    });
    createWebSocketServer(srv, { path: "/chat", chat: { storage, historyLimit: 10 } });
    await new Promise<void>((resolve) => {
      srv.listen(0, () => resolve());
    });
    const addr = srv.address();
    const p = typeof addr === "object" && addr && "port" in addr ? addr.port : 0;

    const ws1 = new WebSocket(`ws://127.0.0.1:${p}/chat`);
    const msgs1: unknown[] = [];
    ws1.on("message", (data) => msgs1.push(JSON.parse(data.toString())));

    await new Promise<void>((resolve) => {
      ws1.on("open", () => {
        ws1.send(JSON.stringify({ type: MSG_JOIN_ROOM, payload: { roomId: "chat-room" } }));
        const check = (): void => {
          if (msgs1.some((m: { type?: string }) => m?.type === MSG_ROOM_JOINED)) {
            resolve();
            return;
          }
          setTimeout(check, 20);
        };
        setTimeout(check, 50);
      });
    });

    const ws2 = new WebSocket(`ws://127.0.0.1:${p}/chat`);
    const msgs2: unknown[] = [];
    ws2.on("message", (data) => msgs2.push(JSON.parse(data.toString())));

    await new Promise<void>((resolve) => {
      ws2.on("open", () => {
        ws2.send(JSON.stringify({ type: MSG_JOIN_ROOM, payload: { roomId: "chat-room" } }));
        const check = (): void => {
          if (msgs2.some((m: { type?: string }) => m?.type === MSG_ROOM_JOINED)) {
            resolve();
            return;
          }
          setTimeout(check, 20);
        };
        setTimeout(check, 50);
      });
    });

    ws1.send(
      JSON.stringify({ type: MSG_SEND_CHAT, payload: { message: "hello from 1" } })
    );

    await new Promise<void>((resolve) => {
      const check = (): void => {
        const chatOn2 = msgs2.some(
          (m: { type?: string }) => m?.type === MSG_CHAT_MESSAGE && (m as { payload?: { message?: string } }).payload?.message === "hello from 1"
        );
        if (chatOn2) {
          resolve();
          return;
        }
        setTimeout(check, 50);
      };
      setTimeout(check, 100);
    });

    const chatMsg = msgs2.find(
      (m: { type?: string; payload?: { message?: string } }) =>
        m?.type === MSG_CHAT_MESSAGE && m?.payload?.message === "hello from 1"
    );
    expect(chatMsg).toBeDefined();

    ws1.close();
    ws2.close();
    await new Promise<void>((resolve) => srv.close(() => resolve()));
  });
});

describe("createServer and createWebSocketHandler", () => {
  it("createServer returns server with .ws WebSocketServer", async () => {
    const server = createServer({ port: 0 });
    expect(server).toBeDefined();
    expect((server as { ws?: unknown }).ws).toBeDefined();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("createWebSocketHandler ignores upgrade on wrong path", () => {
    const handler = createWebSocketHandler({ path: "/live" });
    const request = { url: "/other" } as http.IncomingMessage;
    const socket = { destroy: () => {} } as import("node:stream").Duplex;
    const head = Buffer.alloc(0);
    expect(() => handler(request, socket, head)).not.toThrow();
  });

  it("onAuth returning null closes connection with 4401", async () => {
    const srv = http.createServer((_req, res) => {
      res.writeHead(200);
      res.end();
    });
    createWebSocketServer(srv, {
      path: "/auth",
      onAuth: async () => null,
    });
    await new Promise<void>((resolve) => srv.listen(0, () => resolve()));
    const addr = srv.address();
    const port = typeof addr === "object" && addr && "port" in addr ? addr.port : 0;

    const ws = new WebSocket(`ws://127.0.0.1:${port}/auth`);
    const closeEvent = await new Promise<{ code: number }>((resolve) => {
      ws.on("close", (code: number) => resolve({ code }));
    });
    expect(closeEvent.code).toBe(4401);

    await new Promise<void>((resolve) => srv.close(() => resolve()));
  });

  it("onAuth throwing closes connection with 4500", async () => {
    const srv = http.createServer((_req, res) => {
      res.writeHead(200);
      res.end();
    });
    createWebSocketServer(srv, {
      path: "/auth2",
      onAuth: async () => {
        throw new Error("auth failed");
      },
    });
    await new Promise<void>((resolve) => srv.listen(0, () => resolve()));
    const addr = srv.address();
    const port = typeof addr === "object" && addr && "port" in addr ? addr.port : 0;

    const ws = new WebSocket(`ws://127.0.0.1:${port}/auth2`);
    const closeEvent = await new Promise<{ code: number }>((resolve) => {
      ws.on("close", (code: number) => resolve({ code }));
    });
    expect(closeEvent.code).toBe(4500);

    await new Promise<void>((resolve) => srv.close(() => resolve()));
  });
});
