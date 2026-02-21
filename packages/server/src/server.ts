/**
 * createServer, createWebSocketServer, createWebSocketHandler.
 */

import * as http from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { createInMemoryChatStorage } from "./storage/in-memory.js";
import type { ChatStorage } from "./storage/chat-storage.js";
import type { UserInfo } from "./protocol.js";
import { RoomManager } from "./room-manager.js";
import { Connection } from "./connection.js";

const DEFAULT_PATH = "/live";
const DEFAULT_PRESENCE_THROTTLE_MS = 100;
const DEFAULT_HISTORY_LIMIT = 100;

export interface ChatOptions {
  storage?: ChatStorage;
  historyLimit?: number;
}

export interface WebSocketServerOptions {
  /** WebSocket upgrade path (default: "/live"). */
  path?: string;
  /** If provided and returns null, connection is rejected. */
  onAuth?: (request: http.IncomingMessage) => Promise<UserInfo | null>;
  /** Min interval between presence updates per connection in ms (default: 100). */
  presenceThrottleMs?: number;
  /** Chat storage and history limit. If storage omitted, uses in-memory. */
  chat?: ChatOptions;
}

export interface ServerOptions extends WebSocketServerOptions {
  /** Port for standalone server (default: 3000). */
  port?: number;
}

function randomConnectionId(): string {
  return randomUUID();
}

function createRoomManager(options: WebSocketServerOptions): RoomManager {
  const chat = options.chat ?? {};
  const storage = chat.storage ?? createInMemoryChatStorage({ historyLimit: chat.historyLimit ?? DEFAULT_HISTORY_LIMIT });
  const historyLimit = chat.historyLimit ?? DEFAULT_HISTORY_LIMIT;
  return new RoomManager({ chatStorage: storage, historyLimit });
}

function handleUpgrade(
  wss: WebSocketServer,
  options: WebSocketServerOptions,
  roomManager: RoomManager,
  request: http.IncomingMessage,
  socket: import("node:stream").Duplex,
  head: Buffer
): void {
  const path = options.path ?? DEFAULT_PATH;
  const url = request.url ?? "";
  const pathname = url.split("?")[0];
  if (pathname !== path) return;

  wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
    wss.emit("connection", ws, request);
    const connectionId = randomConnectionId();
    let authResult: UserInfo | null = {};

    const proceed = (): void => {
      const presenceThrottleMs = options.presenceThrottleMs ?? DEFAULT_PRESENCE_THROTTLE_MS;
      new Connection(ws, {
        connectionId,
        userId: authResult?.userId,
        presenceThrottleMs,
        roomManager,
      });
    };

    if (options.onAuth) {
      options.onAuth(request).then((result) => {
        authResult = result;
        if (result === null) {
          ws.close(4401, "Unauthorized");
          return;
        }
        proceed();
      }).catch(() => {
        ws.close(4500, "Auth error");
      });
    } else {
      proceed();
    }
  });
}

/**
 * Returns the raw upgrade handler. Attach to your HTTP server with
 * server.on('upgrade', handler).
 */
export function createWebSocketHandler(
  options: WebSocketServerOptions = {}
): (request: http.IncomingMessage, socket: import("node:stream").Duplex, head: Buffer) => void {
  const roomManager = createRoomManager(options);
  const wss = new WebSocketServer({ noServer: true });
  const path = options.path ?? DEFAULT_PATH;

  return (request: http.IncomingMessage, socket: import("node:stream").Duplex, head: Buffer) => {
    const url = request.url ?? "";
    const pathname = url.split("?")[0];
    if (pathname !== path) return;
    handleUpgrade(wss, options, roomManager, request, socket, head);
  };
}

/**
 * Attaches WebSocket upgrade handling to an existing Node HTTP server.
 * Returns the WebSocketServer instance (e.g. for closing later).
 */
export function createWebSocketServer(
  server: http.Server,
  options: WebSocketServerOptions = {}
): WebSocketServer {
  const roomManager = createRoomManager(options);
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request: http.IncomingMessage, socket: import("node:stream").Duplex, head: Buffer) => {
    handleUpgrade(wss, options, roomManager, request, socket, head);
  });

  return wss;
}

/**
 * Creates an HTTP server with a simple root handler and WebSocket support.
 * Returns the server and the WebSocketServer (as server.ws).
 */
export function createServer(options: ServerOptions = {}): http.Server & { ws: WebSocketServer } {
  const port = options.port ?? 3000;
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("openlivesync");
  });
  const wss = createWebSocketServer(server, options);
  (server as http.Server & { ws: WebSocketServer }).ws = wss;
  server.listen(port);
  return server as http.Server & { ws: WebSocketServer };
}
