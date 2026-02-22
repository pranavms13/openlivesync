import { describe, it, expect, vi, beforeEach } from "vitest";
import { Connection } from "./connection.js";
import { RoomManager } from "./room-manager.js";
import { createInMemoryChatStorage } from "./storage/in-memory.js";
import {
  MSG_JOIN_ROOM,
  MSG_LEAVE_ROOM,
  MSG_UPDATE_PRESENCE,
  MSG_BROADCAST_EVENT,
  MSG_SEND_CHAT,
  MSG_ERROR,
  MSG_ROOM_JOINED,
  MSG_CHAT_MESSAGE,
  MSG_BROADCAST_EVENT_RELAY,
} from "./protocol.js";
import { SignJWT } from "jose";

function createMockWs(): {
  ws: {
    readyState: number;
    on: (ev: string, fn: (data?: unknown) => void) => void;
    emit: (ev: string, data?: unknown) => void;
    send: (data: string) => void;
    close: () => void;
  };
  sent: unknown[];
  emitMessage: (data: string | Buffer) => void;
  emitClose: () => void;
} {
  const listeners: Record<string, (data?: unknown) => void> = {};
  const sent: unknown[] = [];
  return {
    ws: {
      readyState: 1,
      OPEN: 1,
      on(ev: string, fn: (data?: unknown) => void) {
        listeners[ev] = fn;
      },
      emit(ev: string, data?: unknown) {
        if (listeners[ev]) listeners[ev](data);
      },
      send(data: string) {
        sent.push(JSON.parse(data));
      },
      close() {
        listeners["close"]?.();
      },
    },
    sent,
    emitMessage(data: string | Buffer) {
      const raw = typeof data === "string" ? data : data.toString("utf8");
      listeners["message"]?.(raw);
    },
    emitClose() {
      listeners["close"]?.();
    },
  };
}

describe("Connection", () => {
  let mock: ReturnType<typeof createMockWs>;
  let roomManager: RoomManager;

  beforeEach(() => {
    mock = createMockWs();
    const storage = createInMemoryChatStorage({ historyLimit: 10 });
    roomManager = new RoomManager({ chatStorage: storage, historyLimit: 10 });
  });

  it("sends INVALID_JSON error for invalid JSON", () => {
    new Connection(mock.ws as import("ws").WebSocket, {
      connectionId: "c1",
      presenceThrottleMs: 0,
      roomManager,
    });
    mock.emitMessage("not json");
    expect(mock.sent).toHaveLength(1);
    expect(mock.sent[0]).toMatchObject({
      type: MSG_ERROR,
      payload: { code: "INVALID_JSON", message: "Invalid JSON" },
    });
  });

  it("sends INVALID_MESSAGE error for unknown message type", () => {
    new Connection(mock.ws as import("ws").WebSocket, {
      connectionId: "c1",
      presenceThrottleMs: 0,
      roomManager,
    });
    mock.emitMessage(JSON.stringify({ type: "unknown", payload: {} }));
    expect(mock.sent).toHaveLength(1);
    expect(mock.sent[0]).toMatchObject({
      type: MSG_ERROR,
      payload: { code: "INVALID_MESSAGE", message: "Unknown or invalid message type" },
    });
  });

  it("join_room sends room_joined and leave_room cleans up", async () => {
    new Connection(mock.ws as import("ws").WebSocket, {
      connectionId: "c1",
      presenceThrottleMs: 0,
      roomManager,
    });
    mock.emitMessage(
      JSON.stringify({ type: MSG_JOIN_ROOM, payload: { roomId: "r1", presence: { x: 1 } } })
    );
    await vi.waitFor(() => {
      expect(mock.sent.some((m: { type?: string }) => m?.type === MSG_ROOM_JOINED)).toBe(true);
    });
    expect(roomManager.get("r1")?.connectionCount).toBe(1);
    mock.emitMessage(JSON.stringify({ type: MSG_LEAVE_ROOM, payload: { roomId: "r1" } }));
    await vi.waitFor(() => {
      expect(roomManager.get("r1")).toBeUndefined();
    });
  });

  it("update_presence is throttled when throttleMs > 0", async () => {
    const mock1 = createMockWs();
    const mock2 = createMockWs();
    new Connection(mock1.ws as import("ws").WebSocket, {
      connectionId: "c1",
      presenceThrottleMs: 10000,
      roomManager,
    });
    new Connection(mock2.ws as import("ws").WebSocket, {
      connectionId: "c2",
      presenceThrottleMs: 10000,
      roomManager,
    });
    mock1.emitMessage(JSON.stringify({ type: MSG_JOIN_ROOM, payload: { roomId: "r1" } }));
    mock2.emitMessage(JSON.stringify({ type: MSG_JOIN_ROOM, payload: { roomId: "r1" } }));
    await vi.waitFor(() => {
      expect(mock2.sent.some((m: { type?: string }) => m?.type === MSG_ROOM_JOINED)).toBe(true);
    });
    mock2.sent.length = 0;
    mock1.emitMessage(JSON.stringify({ type: MSG_UPDATE_PRESENCE, payload: { presence: { a: 1 } } }));
    mock1.emitMessage(JSON.stringify({ type: MSG_UPDATE_PRESENCE, payload: { presence: { a: 2 } } }));
    await new Promise((r) => setTimeout(r, 10));
    const presenceUpdates = mock2.sent.filter(
      (m: { type?: string }) => m?.type === "presence_updated"
    );
    expect(presenceUpdates.length).toBe(1);
  });

  it("broadcast_event when not in room does nothing", () => {
    new Connection(mock.ws as import("ws").WebSocket, {
      connectionId: "c1",
      presenceThrottleMs: 0,
      roomManager,
    });
    mock.emitMessage(
      JSON.stringify({
        type: MSG_BROADCAST_EVENT,
        payload: { event: "draw", payload: { x: 1 } },
      })
    );
    expect(mock.sent).toHaveLength(0);
  });

  it("send_chat when not in room does nothing", async () => {
    new Connection(mock.ws as import("ws").WebSocket, {
      connectionId: "c1",
      presenceThrottleMs: 0,
      roomManager,
    });
    mock.emitMessage(
      JSON.stringify({ type: MSG_SEND_CHAT, payload: { message: "hi" } })
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(mock.sent).toHaveLength(0);
  });

  it("handleClose leaves room and removes if empty", async () => {
    new Connection(mock.ws as import("ws").WebSocket, {
      connectionId: "c1",
      presenceThrottleMs: 0,
      roomManager,
    });
    mock.emitMessage(JSON.stringify({ type: MSG_JOIN_ROOM, payload: { roomId: "r1" } }));
    await vi.waitFor(() => {
      expect(roomManager.get("r1")?.connectionCount).toBe(1);
    });
    mock.emitClose();
    expect(roomManager.get("r1")).toBeUndefined();
  });

  it("dispatch error sends SERVER_ERROR", async () => {
    const fakeRoom = {
      connectionCount: 0,
      join: () => Promise.reject(new Error("join failed")),
      leave: () => {},
      updatePresence: () => {},
      broadcastEvent: () => {},
      sendChat: () => Promise.resolve(),
    };
    const roomManagerWithFailingJoin = {
      get: () => undefined,
      getOrCreate: () => fakeRoom as import("./room.js").Room,
      removeIfEmpty: () => {},
    };
    new Connection(mock.ws as import("ws").WebSocket, {
      connectionId: "c1",
      presenceThrottleMs: 0,
      roomManager: roomManagerWithFailingJoin as unknown as RoomManager,
    });
    mock.emitMessage(JSON.stringify({ type: MSG_JOIN_ROOM, payload: { roomId: "r1" } }));
    await vi.waitFor(() => {
      const errMsg = mock.sent.find((m: { type?: string }) => m?.type === MSG_ERROR);
      expect(errMsg).toBeDefined();
      expect((errMsg as { payload?: { message?: string } }).payload?.message).toBe("join failed");
    });
  });

  it("leave_room with no current room does nothing", () => {
    new Connection(mock.ws as import("ws").WebSocket, {
      connectionId: "c1",
      presenceThrottleMs: 0,
      roomManager,
    });
    mock.emitMessage(JSON.stringify({ type: MSG_LEAVE_ROOM }));
    expect(mock.sent).toHaveLength(0);
  });

  it("ignores messages after close", () => {
    new Connection(mock.ws as import("ws").WebSocket, {
      connectionId: "c1",
      presenceThrottleMs: 0,
      roomManager,
    });
    mock.emitClose();
    mock.emitMessage(JSON.stringify({ type: MSG_JOIN_ROOM, payload: { roomId: "r1" } }));
    expect(mock.sent).toHaveLength(0);
  });

  it("joining another room leaves current room and removeIfEmpty clears it", async () => {
    new Connection(mock.ws as import("ws").WebSocket, {
      connectionId: "c1",
      presenceThrottleMs: 0,
      roomManager,
    });
    mock.emitMessage(JSON.stringify({ type: MSG_JOIN_ROOM, payload: { roomId: "r1" } }));
    await vi.waitFor(() => {
      expect(roomManager.get("r1")?.connectionCount).toBe(1);
    });
    mock.emitMessage(JSON.stringify({ type: MSG_JOIN_ROOM, payload: { roomId: "r2" } }));
    await vi.waitFor(() => {
      expect(mock.sent.some((m: { type?: string }) => m?.type === MSG_ROOM_JOINED)).toBe(true);
    });
    expect(roomManager.get("r1")).toBeUndefined();
    expect(roomManager.get("r2")?.connectionCount).toBe(1);
  });

  it("broadcast_event when in room forwards to room", async () => {
    const mock2 = createMockWs();
    new Connection(mock.ws as import("ws").WebSocket, {
      connectionId: "c1",
      presenceThrottleMs: 0,
      roomManager,
    });
    new Connection(mock2.ws as import("ws").WebSocket, {
      connectionId: "c2",
      presenceThrottleMs: 0,
      roomManager,
    });
    mock.emitMessage(JSON.stringify({ type: MSG_JOIN_ROOM, payload: { roomId: "br" } }));
    mock2.emitMessage(JSON.stringify({ type: MSG_JOIN_ROOM, payload: { roomId: "br" } }));
    await vi.waitFor(() => {
      expect(mock2.sent.some((m: { type?: string }) => m?.type === MSG_ROOM_JOINED)).toBe(true);
    });
    mock2.sent.length = 0;
    mock.emitMessage(
      JSON.stringify({
        type: MSG_BROADCAST_EVENT,
        payload: { event: "draw", payload: { x: 1 } },
      })
    );
    await vi.waitFor(() => {
      expect(mock2.sent.some((m: { type?: string }) => m?.type === MSG_BROADCAST_EVENT_RELAY)).toBe(true);
    });
  });

  it("send_chat when in room appends and broadcasts", async () => {
    new Connection(mock.ws as import("ws").WebSocket, {
      connectionId: "c1",
      presenceThrottleMs: 0,
      roomManager,
    });
    mock.emitMessage(JSON.stringify({ type: MSG_JOIN_ROOM, payload: { roomId: "cr" } }));
    await vi.waitFor(() => {
      expect(mock.sent.some((m: { type?: string }) => m?.type === MSG_ROOM_JOINED)).toBe(true);
    });
    mock.emitMessage(JSON.stringify({ type: MSG_SEND_CHAT, payload: { message: "hello room" } }));
    await vi.waitFor(() => {
      const chatMsg = mock.sent.find(
        (m: { type?: string; payload?: { message?: string } }) =>
          m?.type === MSG_CHAT_MESSAGE && m?.payload?.message === "hello room"
      );
      expect(chatMsg).toBeDefined();
    });
  });

  it("join_room with accessToken sets userId, name, email, provider from decoded token", async () => {
    const secret = new TextEncoder().encode("auth-secret");
    const token = await new SignJWT({
      sub: "auth-user-1",
      name: "Auth User",
      email: "auth@example.com",
      iss: "https://accounts.google.com",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(secret);

    new Connection(mock.ws as import("ws").WebSocket, {
      connectionId: "c1",
      presenceThrottleMs: 0,
      roomManager,
      auth: {},
    });
    mock.emitMessage(
      JSON.stringify({
        type: MSG_JOIN_ROOM,
        payload: { roomId: "r1", presence: {}, accessToken: token },
      })
    );
    await vi.waitFor(() => {
      expect(mock.sent.some((m: { type?: string }) => m?.type === MSG_ROOM_JOINED)).toBe(true);
    });
    const roomJoined = mock.sent.find((m: { type?: string }) => m?.type === MSG_ROOM_JOINED) as {
      payload?: { presence?: Record<string, { userId?: string; name?: string; email?: string; provider?: string }> };
    };
    const selfEntry = roomJoined?.payload?.presence?.["c1"];
    expect(selfEntry?.userId).toBe("auth-user-1");
    expect(selfEntry?.name).toBe("Auth User");
    expect(selfEntry?.email).toBe("auth@example.com");
    expect(selfEntry?.provider).toBe("google");
  });
});
