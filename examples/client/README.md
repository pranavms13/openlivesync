# OpenLiveSync example client

React app that demonstrates **@openlivesync/client** and **@openlivesync/client/react** usage.

## What it demonstrates

- **LiveSyncProvider** — Wrap app with `url` and `reconnect`; provider creates the client and connects on mount.
- **useConnectionStatus** — Connection status badge (connecting / open / closing / closed).
- **useRoom** — Join/leave room, `initialPresence`, `autoJoin`, `updatePresence`, `broadcastEvent`.
- **Identity (name/email or accessToken)** — The example passes `name`/`email` via `useRoom` options so they are shared with other participants; you could also pass an `accessToken` instead and let the server decode name/email from the token.
- **usePresence** — Presence map for the current room (list of who’s in the room with name/color/email).
- **useChat** — Chat messages and `sendMessage` for the room.
- **useLiveSyncClient** — Access the client and `getState()` for debugging.

### Identity in this example

The example uses `useRoom(roomId, options)` with identity fields:

```ts
const { join, leave, ... } = useRoom(roomId, {
  initialPresence: { color: "#0d6efd" },
  autoJoin: true,
  name,   // taken from local state and shared as presence/identity
  email,  // optional; shown in the presence list
  // accessToken?: string  // alternatively, pass a token here instead of name/email
});
```

On the server, these values end up in `PresenceEntry` (`name`, `email`, `provider` when using a token), so other participants can see who is in the room.

## Prerequisites

Build the client package from the repo root:

```bash
cd ../..
npm run build
cd packages/client && npm run build && cd ../..
```

Start the example server (in `examples/server`) so the WebSocket endpoint is available:

```bash
cd examples/server && npm run dev
```

## Install and run

1. From repo root, build packages and install example deps:

   ```bash
   npm run build
   cd examples/client && npm install
   ```

2. Start the backend (in another terminal): `cd examples/server && npm install && npm run dev`

3. Start the client: `npm run dev` (from `examples/client`)

   Or from repo root run both at once: `npm run dev`

Open http://localhost:5173. In development the app connects to `ws://localhost:5173/live` and Vite proxies WebSocket to the backend on port 3000, so the backend must be running. Open a second tab to see presence and chat in real time.

## Configuration

- **Development**: The app uses the current host (`/live`) so the Vite dev server can proxy WebSocket to the backend.
- **Production**: Set `VITE_WS_URL` at build time (e.g. `wss://your-server/live`) or the app falls back to `ws://localhost:3000/live`.

