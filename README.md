# OpenLiveSync

[![CI](https://github.com/pranavms13/openlivesync/actions/workflows/ci.yml/badge.svg)](https://github.com/pranavms13/openlivesync/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/pranavms13/openlivesync/branch/main/graph/badge.svg)](https://codecov.io/gh/pranavms13/openlivesync)

Real-time **presence**, **collaboration events**, and **chat** with a small server package and an optional client.

## Monorepo structure

| Package | Description |
|--------|-------------|
| [packages/server](./packages/server) | Node.js server: WebSocket API, rooms, presence, broadcast, chat with pluggable storage (in-memory, Postgres, MySQL, SQLite). |
| [packages/client](./packages/client) | Browser client: WebSocket API, presence, broadcast, chat; optional React hooks. |

## Examples

| Example | Description |
|--------|-------------|
| [examples/server](./examples/server) | Node.js server using `createServer`, path, chat, and optional `createTokenAuth`. |
| [examples/client](./examples/client) | React app using `LiveSyncProvider`, `useConnectionStatus`, `useRoom`, `usePresence`, `useChat`, and `useLiveSyncClient`. |

From repo root: `npm run build`, then run `npm run dev` to start both the example server and client concurrently. Open the client in multiple tabs to see presence and chat in real time.

## Setup

```bash
git clone https://github.com/pranavms13/openlivesync.git
cd openlivesync
npm install
```

## Scripts (from repo root)

| Command | Description |
|---------|-------------|
| `npm run build` | Build all packages. |
| `npm run clean` | Remove build artifacts. |
| `npm run lint` | Run ESLint. |
| `npm version <major\|minor\|patch>` | Bump version at root and in `packages/client` and `packages/server`; use `--no-git-tag-version` to skip commit/tag. |

## Package scripts

- **Server** (`cd packages/server`): `npm run build`, `npm run test`, `npm run test:watch`, `npm run test:coverage`. See [packages/server/README.md](./packages/server/README.md) for API and usage.
- **Client** (`cd packages/client`): `npm run build`. See [packages/client/README.md](./packages/client/README.md) for API and usage.

## License

See [LICENSE](./LICENSE) if present; otherwise assume MIT.
