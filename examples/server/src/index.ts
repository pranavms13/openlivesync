/**
 * OpenLiveSync example server.
 * Demonstrates: createServer, path, chat (in-memory), optional auth (createTokenAuth).
 */

import {
  createServer,
  createTokenAuth,
  type AuthOptions,
} from "@openlivesync/server";

const PORT = 3000;

// Optional: decode-only auth so clients can send tokens and get name/email in presence.
// Omit or set to undefined to run without auth.
const authOptions: AuthOptions | undefined = undefined;
// Example with decode-only (no verification) for development:
// const authOptions: AuthOptions = { custom: { decodeOnly: true } };

const server = createServer({
  port: PORT,
  path: "/live",
  presenceThrottleMs: 100,
  chat: {
    historyLimit: 100,
    // storage omitted => in-memory chat storage
  },
  ...(authOptions
    ? { onAuth: createTokenAuth(authOptions) }
    : {}),
});

console.log(`OpenLiveSync server listening on http://localhost:${PORT}`);
console.log(`WebSocket endpoint: ws://localhost:${PORT}/live`);
console.log("Press Ctrl+C to stop.");

process.on("SIGINT", () => {
  server.ws?.close();
  server.close();
  process.exit(0);
});
