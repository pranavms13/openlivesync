/**
 * OpenLiveSync ReactFlow example server.
 * Enables Yjs CRDT sync with in-memory persistence.
 */

import { createServer } from "@openlivesync/server";

const PORT = 3000;

const server = createServer({
  port: PORT,
  path: "/live",
  yjs: {},
});

console.log(`ReactFlow sync server listening on http://localhost:${PORT}`);
console.log(`WebSocket endpoint: ws://localhost:${PORT}/live`);
console.log("Press Ctrl+C to stop.");

process.on("SIGINT", () => {
  server.ws?.close();
  server.close();
  process.exit(0);
});
