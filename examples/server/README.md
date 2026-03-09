# OpenLiveSync example server

Node.js server that demonstrates **@openlivesync/server** usage.

## What it demonstrates

- **createServer** — Standalone HTTP + WebSocket server
- **path** — WebSocket path (`/live`)
- **presenceThrottleMs** — Throttling presence updates
- **chat** — In-memory chat with `historyLimit`
- **Optional auth** — Uncomment `createTokenAuth` in `src/index.ts` to use token-at-connect auth
- **Optional Redis adapter** — Set `REDIS_URL` to enable Redis-based multi-instance presence, chat, and event sync

## Prerequisites

Build the server package from the repo root:

```bash
cd ../..
npm run build
cd packages/server && npm run build && cd ../..
```

## Install and run

```bash
npm install
npm run dev
# or: npm run build && npm start
```

- HTTP: http://localhost:3000 (returns "openlivesync")
- WebSocket: ws://localhost:3000/live

Run the example client (in `examples/client`) and open multiple tabs to see presence and chat.

## Enable Redis-based horizontal scaling

To run the example with Redis-backed multi-instance sync, install `ioredis` and set a Redis URL:

```bash
npm install ioredis
REDIS_URL="redis://localhost:6379" npm run dev
```

Now you can start multiple copies of this example server (for example on different ports behind a load balancer). Presence, chat messages, and `broadcast_event` custom events will be synchronized across all instances via Redis.
