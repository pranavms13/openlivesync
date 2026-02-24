# @openlivesync/client

Browser client for OpenLiveSync: connect to an `@openlivesync/server` over WebSocket for presence, broadcast events, and chat. Use the core API or the optional React hooks.

## Installation

```bash
npm install @openlivesync/client
```

For React hooks (optional):

```bash
npm install @openlivesync/client react
```

## Core usage

Create a client, connect, and join a room. Subscribe to state updates:

```ts
import { createLiveSyncClient } from "@openlivesync/client";

const client = createLiveSyncClient({
  url: "wss://localhost:3000/live",
  reconnect: true,
});

client.connect();
// Join with manual name/email (no token)
client.joinRoom("room1", { color: "#00f" }, { name: "Alice", email: "alice@example.com" });
// Or join with an access token so the server decodes name/email/provider (OAuth / OpenID)
// client.joinRoom("room1", { color: "#00f" }, { accessToken });
client.subscribe((state) => console.log(state.presence));

client.updatePresence({ cursor: { x: 10, y: 20 } });
client.broadcastEvent("cursor_move", { x: 10, y: 20 });
client.sendChat("Hello!");
client.leaveRoom();
client.disconnect();
```

## React usage

Wrap your app in `LiveSyncProvider` (pass a pre-created `client` or config like `url`), then use hooks:

```tsx
import { LiveSyncProvider, useRoom, useChat, useConnectionStatus } from "@openlivesync/client/react";

// With config (provider creates client and connects on mount)
function App() {
  return (
    <LiveSyncProvider url="wss://localhost:3000/live">
      <RoomUI roomId="room1" />
    </LiveSyncProvider>
  );
}

function RoomUI({ roomId }: { roomId: string }) {
  const status = useConnectionStatus();
  const { presence, join, leave, broadcastEvent } = useRoom(roomId);
  const { messages, sendMessage } = useChat(roomId);

  return (
    <div>
      <p>Status: {status}</p>
      <button onClick={() => leave()}>Leave</button>
      <ul>
        {Object.entries(presence).map(([id, e]) => (
          <li key={id}>{String(e.presence?.name ?? id)}</li>
        ))}
      </ul>
      {messages.map((m) => (
        <p key={m.id}>{m.message}</p>
      ))}
      <button onClick={() => sendMessage("Hi!")}>Send</button>
    </div>
  );
}
```

Or pass a pre-created client:

```tsx
import { createLiveSyncClient } from "@openlivesync/client";
import { LiveSyncProvider } from "@openlivesync/client/react";

const client = createLiveSyncClient({ url: "wss://localhost:3000/live" });
client.connect();

<LiveSyncProvider client={client}>
  <App />
</LiveSyncProvider>
```

## API

### Core (`@openlivesync/client`)

- **`createLiveSyncClient(config)`** — Returns a client. Options: `url`, `reconnect?`, `reconnectIntervalMs?`, `maxReconnectIntervalMs?`, `getAuthToken?`, `presenceThrottleMs?`.
- **Client methods**: `connect()`, `disconnect()`, `joinRoom(roomId, presence?, identity?)`, `leaveRoom(roomId?)`, `updatePresence(presence)`, `broadcastEvent(event, payload?)`, `sendChat(message, metadata?)`, `getState()`, `subscribe(listener)`.
  - **`identity`** is `{ accessToken?, name?, email? }`.
    - If you pass an **`accessToken`**, the server (when configured with `auth`) decodes it and attaches `name`, `email`, and `provider` to your connection; other clients see them in presence.
    - If you pass only **`name`/`email`** (no token), the server uses those values directly and shares them with other participants via `PresenceEntry`.
    - If you pass both, the token takes priority (decoded claims win); if decoding fails, the server falls back to the provided `name`/`email`.
  - **Authenticate once at connect (recommended):** use only `getAuthToken` in config (token is sent in the URL at connect) and do **not** pass `accessToken` to `joinRoom` or `useRoom`; the server will recognize you for the connection lifetime.

### React (`@openlivesync/client/react`)

- **`LiveSyncProvider`** — Props: `client?` or `url?` (+ optional reconnect/auth/presence options). If `url` is provided, the provider creates the client and connects on mount.
- **`useLiveSyncClient()`** — Returns the client from context.
- **`useConnectionStatus()`** — Returns `"connecting" | "open" | "closing" | "closed"`.
- **`useRoom(roomId, options?)`** — Returns `{ join, leave, updatePresence, broadcastEvent, presence, connectionId, isInRoom, currentRoomId }`.
  - **Options**: `initialPresence?`, `autoJoin?`, `accessToken?`, `getAccessToken?`, `name?`, `email?`.
    - With `autoJoin: true` (default), joins when `roomId` is set using an identity built from `{ accessToken (or getAccessToken()), name, email }` and leaves on unmount or when `roomId` changes.
    - `join(roomId, presence?, identity?)` for manual join, where `identity` is `{ accessToken?, name?, email? }`.
    - For connect-only auth (token sent once at connect via provider's `getAuthToken`), omit `accessToken`, `getAccessToken`, and `identity.accessToken` here and rely on the connection identity established at upgrade.
- **`usePresence(roomId)`** — Returns the presence map for the current room.
- **`useChat(roomId)`** — Returns `{ messages, sendMessage }`.

Protocol types and `MSG_*` constants are exported from the main entry for typing or custom handling.
