# @openlivesync/server

Node.js server package for **OpenLiveSync**. Provides WebSocket-based **presence**, **live collaboration events**, and **chat** with pluggable storage.

## Features

- **Presence** — Track who’s in a room and arbitrary presence state (e.g. cursor, name, color). Join/leave and updates are broadcast to the room.
- **Broadcast** — Send collaboration events to all other clients in the same room.
- **Chat** — Room-based messages with optional persistence (in-memory, Postgres, MySQL, or SQLite).

## Installation

```bash
npm install @openlivesync/server
```

For database-backed chat, install the driver you need (optional):

```bash
# One or more, depending on which storage you use:
npm install pg
npm install mysql2
npm install better-sqlite3
```

## Quick start

**Standalone server** (HTTP + WebSocket on port 3000, default in-memory chat):

```ts
import { createServer } from "@openlivesync/server";

const server = createServer({ port: 3000 });
// WebSocket endpoint: ws://localhost:3000/live
// HTTP GET / returns "openlivesync"
```

**Attach to an existing HTTP server** (e.g. Express, Fastify):

```ts
import http from "node:http";
import { createWebSocketServer } from "@openlivesync/server";

const httpServer = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Hello");
});

createWebSocketServer(httpServer, { path: "/live" });

httpServer.listen(3000);
// WebSocket: ws://localhost:3000/live
```

**Raw upgrade handler** (you control path and routing):

```ts
import http from "node:http";
import { createWebSocketHandler } from "@openlivesync/server";

const server = http.createServer(/* ... */);
const handleUpgrade = createWebSocketHandler({ path: "/live" });
server.on("upgrade", handleUpgrade);
server.listen(3000);
```

## API

### `createServer(options?)`

Creates an `http.Server` that serves a simple root response and handles WebSocket upgrades. Returns the server with a `ws` property (the `WebSocketServer`).

- **Options**: `ServerOptions` (includes `port`, default `3000`, and all `WebSocketServerOptions`).

### `createWebSocketServer(server, options?)`

Attaches WebSocket upgrade handling to an existing Node `http.Server`. Returns the `WebSocketServer` (e.g. for `wss.close()`).

- **Options**: `WebSocketServerOptions`.

### `createWebSocketHandler(options?)`

Returns a function `(request, socket, head) => void` that you pass to `server.on("upgrade", handler)`. Use this when you want to handle the upgrade path yourself.

- **Options**: `WebSocketServerOptions`.

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `path` | `string` | `"/live"` | WebSocket upgrade path. |
| `onAuth` | `(req) => Promise<UserInfo \| null>` | — | If provided, runs on each upgrade. Return `null` to reject the connection (401). Return `{ userId?, ... }` to attach user info to the connection. |
| `presenceThrottleMs` | `number` | `100` | Minimum ms between presence updates per connection. |
| `chat` | `{ storage?, historyLimit? }` | — | Chat config. Omit `storage` to use in-memory. `historyLimit` is how many messages to send to new joiners (default `100`). |
| `port` | `number` | `3000` | Only for `createServer`: port to listen on. |

**Example with auth and custom path:**

```ts
import { createWebSocketServer } from "@openlivesync/server";
import type { UserInfo } from "@openlivesync/server";
import type { IncomingMessage } from "node:http";

createWebSocketServer(httpServer, {
  path: "/collab",
  presenceThrottleMs: 50,
  onAuth: async (req: IncomingMessage): Promise<UserInfo | null> => {
    const token = req.headers["authorization"]?.replace(/^Bearer\s+/i, "");
    if (!token) return null;
    const user = await myAuthService.verify(token); // your logic
    return user ? { userId: user.id, ...user } : null;
  },
  chat: { historyLimit: 200 },
});
```

## Chat storage

Chat history can be in-memory (default) or backed by Postgres, MySQL, or SQLite. Pass a `ChatStorage` instance in `chat.storage`. All adapters implement `getHistory(roomId, limit?, offset?)`; messages are returned **oldest first**, and `limit`/`offset` support pagination.

### In-memory (default)

No extra install. Keeps the last N messages per room in process memory.

```ts
import {
  createWebSocketServer,
  createInMemoryChatStorage,
} from "@openlivesync/server";

const storage = createInMemoryChatStorage({ historyLimit: 100 });
createWebSocketServer(server, {
  chat: { storage, historyLimit: 100 },
});
```

### Postgres

Requires `pg`. Creates table `openlivesync_chat` if it doesn’t exist.

```ts
import {
  createWebSocketServer,
  createPostgresChatStorage,
} from "@openlivesync/server";

const storage = await createPostgresChatStorage(
  { connectionString: process.env.DATABASE_URL },
  { tableName: "openlivesync_chat", historyLimit: 100 }
);
createWebSocketServer(server, { chat: { storage, historyLimit: 100 } });
```

Connection config can be a string or an object:

```ts
await createPostgresChatStorage(
  { host: "localhost", port: 5432, database: "app", user: "app", password: "secret" },
  { tableName: "my_chat", historyLimit: 200 }
);
```

### MySQL

Requires `mysql2`. Creates the chat table if it doesn’t exist.

```ts
import {
  createWebSocketServer,
  createMySQLChatStorage,
} from "@openlivesync/server";

const storage = await createMySQLChatStorage(
  {
    host: "localhost",
    port: 3306,
    database: "app",
    user: "app",
    password: "secret",
  },
  { tableName: "openlivesync_chat", historyLimit: 100 }
);
createWebSocketServer(server, { chat: { storage, historyLimit: 100 } });
```

### SQLite

Requires `better-sqlite3`. Pass a file path or `{ filename: "path/to/db.sqlite" }`.

```ts
import {
  createWebSocketServer,
  createSQLiteChatStorage,
} from "@openlivesync/server";

const storage = createSQLiteChatStorage("./data/chat.sqlite", {
  tableName: "openlivesync_chat",
  historyLimit: 100,
});
createWebSocketServer(server, { chat: { storage, historyLimit: 100 } });
```

### Custom storage

Implement the `ChatStorage` interface and pass it as `chat.storage`:

- **`append(roomId, message)`** — Persist a chat message.
- **`getHistory(roomId, limit?, offset?)`** — Return messages for the room, **oldest first**. Use `limit` and `offset` for pagination (e.g. `getHistory(roomId, 20, 40)` returns the third page of 20 messages). Defaults: `limit` from adapter config, `offset` = 0.
- **`close()`** — Optional cleanup.

```ts
import type { ChatStorage, ChatMessageInput } from "@openlivesync/server";
import type { StoredChatMessage } from "@openlivesync/server";

const myStorage: ChatStorage = {
  async append(roomId: string, message: ChatMessageInput): Promise<void> {
    // persist to your backend
  },
  async getHistory(
    roomId: string,
    limit?: number,
    offset?: number
  ): Promise<StoredChatMessage[]> {
    // return messages oldest first; use limit/offset for pagination
    return [];
  },
  async close(): Promise<void> {
    // optional cleanup
  },
};
```

## Wire protocol

Clients connect over WebSocket and send/receive JSON messages with a `type` field. The server handles these message types:

### Client → Server

| `type` | Purpose |
|--------|--------|
| `join_room` | Join a room. Payload: `{ roomId, presence? }`. |
| `leave_room` | Leave current room. Payload: `{ roomId? }` (optional). |
| `update_presence` | Update presence. Payload: `{ presence }`. Throttled per connection. |
| `broadcast_event` | Send collaboration event. Payload: `{ event, payload? }`. |
| `send_chat` | Send chat message. Payload: `{ message, metadata? }`. |

### Server → Client

| `type` | Purpose |
|--------|--------|
| `room_joined` | Sent after join. Payload: `{ roomId, connectionId, presence, chatHistory? }`. |
| `presence_updated` | Broadcast. Payload: `{ roomId, joined?, left?, updated? }`. |
| `broadcast_event` | Relayed event. Payload: `{ roomId, connectionId, userId?, event, payload? }`. |
| `chat_message` | Chat message. Payload: `{ roomId, connectionId, userId?, message, metadata? }`. |
| `error` | Error. Payload: `{ code, message }`. |

Presence is an arbitrary JSON object per connection (e.g. `{ cursor: { x, y }, name, color }`). The server does not interpret it; it only stores and broadcasts it.

Use the same message types and constants in your client; they are exported from this package (see **Types** below).

## Types and constants

For building a compatible client or typing your app, the package exports:

- **Server API**: `createServer`, `createWebSocketServer`, `createWebSocketHandler`, `ServerOptions`, `WebSocketServerOptions`, `ChatOptions`.
- **Protocol types**: `Presence`, `UserInfo`, `ClientMessage`, `ServerMessage`, `JoinRoomPayload`, `RoomJoinedPayload`, `PresenceEntry`, `StoredChatMessage`, `ChatMessageInput`, etc.
- **Message type constants**: `MSG_JOIN_ROOM`, `MSG_LEAVE_ROOM`, `MSG_UPDATE_PRESENCE`, `MSG_BROADCAST_EVENT`, `MSG_SEND_CHAT`, `MSG_ROOM_JOINED`, `MSG_PRESENCE_UPDATED`, `MSG_BROADCAST_EVENT_RELAY`, `MSG_CHAT_MESSAGE`, `MSG_ERROR`.
- **Storage**: `ChatStorage`, `createInMemoryChatStorage`, `createPostgresChatStorage`, `createMySQLChatStorage`, `createSQLiteChatStorage`, and their option types.

Example (client or shared code):

```ts
import type { ClientMessage, ServerMessage, Presence } from "@openlivesync/server";
import { MSG_JOIN_ROOM, MSG_ROOM_JOINED } from "@openlivesync/server";
```

## Scripts

- `npm run build` — Compile TypeScript to `dist/`.
- `npm run clean` — Remove `dist/`.
- `npm run test` — Run tests (Vitest).
- `npm run test:watch` — Run tests in watch mode.
- `npm run test:coverage` — Run tests with coverage (V8). Reports in `./coverage` (text summary in terminal, HTML in `coverage/index.html`, lcov for CI).

## Testing

Tests use [Vitest](https://vitest.dev/) and live next to the source as `*.test.ts` files.

```bash
npm run test
```

Coverage (V8) is available via:

```bash
npm run test:coverage
```

Reports are written to `./coverage` (text in the terminal, `coverage/index.html` for a browseable report, and `coverage/lcov.info` for CI). Test files, config, and type declarations are excluded from coverage.

Coverage includes:

- **Protocol** — Message type constants.
- **In-memory storage** — `append`, `getHistory` (limit, offset), room isolation, cap at `historyLimit`.
- **Room & RoomManager** — Join (room_joined with presence and chat history), leave (presence_updated), updatePresence, broadcastEvent, sendChat; getOrCreate, get, removeIfEmpty.
- **WebSocket server** — Integration tests: connect, send `join_room`, receive `room_joined`; two clients in same room, send chat, second client receives `chat_message`.

## License

See repository root.
