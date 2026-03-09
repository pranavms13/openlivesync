/**
 * OpenLiveSync example server.
 * Demonstrates: createServer, path, chat (in-memory), optional auth (createTokenAuth),
 * and optional Redis adapter for horizontal scaling.
 */

import {
  createServer,
  createTokenAuth,
  createRedisAdapter,
  type AuthOptions,
  type RoomAdapter,
} from "@openlivesync/server";

const PORT = 3000;

// Optional: decode-only auth so clients can send tokens and get name/email in presence.
// Omit or set to undefined to run without auth.
const authOptions: AuthOptions | undefined = undefined;
// Example with decode-only (no verification) for development:
// const authOptions: AuthOptions = { custom: { decodeOnly: true } };

// Optional: Redis adapter for horizontal scaling.
// Set REDIS_URL (e.g. redis://localhost:6379) to enable cross-instance sync.
const REDIS_URL = process.env.REDIS_URL;
let adapter: RoomAdapter | undefined;
if (REDIS_URL) {
  adapter = await createRedisAdapter({ url: REDIS_URL });
}

const server = createServer({
  port: PORT,
  path: "/live",
  presenceThrottleMs: 100,
  chat: {
    historyLimit: 100,
    // storage omitted => in-memory chat storage
  },
  ...(authOptions ? { onAuth: createTokenAuth(authOptions) } : {}),
  ...(adapter ? { adapter } : {}),
});

console.log(`OpenLiveSync server listening on http://localhost:${PORT}`);
console.log(`WebSocket endpoint: ws://localhost:${PORT}/live`);
if (adapter) {
  console.log(
    `Redis adapter enabled (REDIS_URL=${REDIS_URL}). You can run multiple server instances behind a load balancer.`
  );
} else {
  console.log(
    "Redis adapter disabled (no REDIS_URL set). Running single-instance mode."
  );
}
console.log("Press Ctrl+C to stop.");

process.on("SIGINT", () => {
  server.ws?.close();
  server.close();
  process.exit(0);
});
