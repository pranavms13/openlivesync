/**
 * Redis room adapter. Requires optional peer dependency: ioredis
 * Install with: npm install ioredis
 *
 * Uses Pub/Sub for cross-instance events and Redis hashes/sets for presence.
 */

import type { PresenceEntry, ServerMessage } from "../protocol.js";

/** Minimal Redis client interface (implemented by ioredis). Avoids importing ioredis at compile time. */
export interface RedisClientLike {
  publish(channel: string, message: string): Promise<number>;
  subscribe(channel: string): Promise<void>;
  unsubscribe(channel?: string): Promise<void>;
  on(event: string, listener: (channel: string, raw: string) => void): unknown;
  sadd(key: string, ...members: string[]): Promise<number>;
  srem(key: string, ...members: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
  zadd(key: string, score: number, member: string): Promise<number>;
  zrem(key: string, ...members: string[]): Promise<number>;
  zrange(key: string, min: number, max: number): Promise<string[]>;
  zrangebyscore(key: string, min: number | string, max: number | string): Promise<string[]>;
  hset(key: string, object: Record<string, string>): Promise<number>;
  hgetall(key: string): Promise<Record<string, string>>;
  del(key: string): Promise<number>;
  multi(): RedisPipelineLike;
  quit(): Promise<string>;
}

export interface RedisPipelineLike {
  sadd(key: string, ...members: string[]): RedisPipelineLike;
  hset(key: string, object: Record<string, string>): RedisPipelineLike;
  zadd(key: string, score: number, member: string): RedisPipelineLike;
  zrem(key: string, ...members: string[]): RedisPipelineLike;
  del(key: string): RedisPipelineLike;
  exec(): Promise<[Error | null, unknown][] | null>;
}
import { MSG_PRESENCE_UPDATED } from "../protocol.js";
import type { RoomAdapter } from "./adapter.js";

const CHANNEL_PREFIX = "room:";
const CHANNEL_SUFFIX = ":events";
const MEMBERS_KEY_PREFIX = "room:";
const MEMBERS_KEY_SUFFIX = ":members";
const PRESENCE_KEY_PREFIX = "room:";
const PRESENCE_KEY_SUFFIX = ":presence:";

function channelName(roomId: string): string {
  return CHANNEL_PREFIX + roomId + CHANNEL_SUFFIX;
}

function membersKey(roomId: string): string {
  return MEMBERS_KEY_PREFIX + roomId + MEMBERS_KEY_SUFFIX;
}

function presenceKey(roomId: string, gConnId: string): string {
  return PRESENCE_KEY_PREFIX + roomId + PRESENCE_KEY_SUFFIX + gConnId;
}

export interface RedisAdapterOptions {
  /** Redis URL (e.g. redis://localhost:6379). Creates two connections (commands+publish, subscribe). */
  url?: string;
  /** Existing Redis client for commands and publish. Requires subscriber when used. */
  client?: RedisClientLike;
  /** Existing Redis client for subscribe. Required when client is provided. */
  subscriber?: RedisClientLike;
  /** Unique id for this server instance (default: random UUID). */
  instanceId?: string;
  /** Interval in ms to refresh presence heartbeats (default: 5000). */
  heartbeatIntervalMs?: number;
  /** TTL in ms before presence entries are considered stale and removed (default: 15000). */
  heartbeatTtlMs?: number;
}

interface Envelope {
  instanceId: string;
  message: ServerMessage;
}

export async function createRedisAdapter(
  options: RedisAdapterOptions
): Promise<RoomAdapter> {
  const instanceId =
    options.instanceId ?? crypto.randomUUID?.() ?? `instance-${Date.now()}`;

  let client: RedisClientLike;
  let subscriber: RedisClientLike;

  if (options.client != null && options.subscriber != null) {
    client = options.client;
    subscriber = options.subscriber;
  } else if (options.url) {
    type RedisConstructor = new (url?: string) => RedisClientLike;
    let RedisConstructor: RedisConstructor;
    try {
      const pkg = "ioredis";
      const ioredis = await import(/* @vite-ignore */ pkg) as { default: RedisConstructor };
      RedisConstructor = ioredis.default;
    } catch {
      throw new Error(
        'Redis adapter requires the "ioredis" package. Install it with: npm install ioredis'
      );
    }
    client = new RedisConstructor(options.url);
    subscriber = new RedisConstructor(options.url);
  } else {
    throw new Error(
      "Redis adapter requires url or both client and subscriber options"
    );
  }

  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 5000;
  const heartbeatTtlMs = options.heartbeatTtlMs ?? 15000;
  const localConnections = new Map<string, Set<string>>(); // roomId -> set of local connectionIds

  const subscriptions = new Map<string, (message: ServerMessage) => void>();

  subscriber.on("message", (channel: string, raw: string) => {
    const handler = subscriptions.get(channel);
    if (!handler) return;
    let envelope: Envelope;
    try {
      envelope = JSON.parse(raw) as Envelope;
    } catch {
      return;
    }
    if (envelope.instanceId === instanceId) return;
    handler(envelope.message);
  });

  function gConnId(connectionId: string): string {
    return `${instanceId}:${connectionId}`;
  }

  function entryFromHash(
    gConnIdKey: string,
    hash: Record<string, string>
  ): PresenceEntry {
    const presenceRaw = hash.presence;
    let presence: Record<string, unknown> = {};
    if (presenceRaw) {
      try {
        presence = JSON.parse(presenceRaw) as Record<string, unknown>;
      } catch {
        /* ignore */
      }
    }
    return {
      connectionId: gConnIdKey,
      userId: hash.userId || undefined,
      name: hash.name || undefined,
      email: hash.email || undefined,
      provider: hash.provider || undefined,
      presence,
    };
  }

  const adapter: RoomAdapter = {
    instanceId,

    async joinRoom(roomId: string, entry: PresenceEntry): Promise<void> {
      let connections = localConnections.get(roomId);
      if (!connections) {
        connections = new Set();
        localConnections.set(roomId, connections);
      }
      connections.add(entry.connectionId);

      const gid = gConnId(entry.connectionId);
      const key = presenceKey(roomId, gid);
      await client
        .multi()
        .zadd(membersKey(roomId), Date.now(), gid)
        .hset(key, {
          userId: entry.userId ?? "",
          name: entry.name ?? "",
          email: entry.email ?? "",
          provider: entry.provider ?? "",
          presence: JSON.stringify(entry.presence ?? {}),
        })
        .exec();

      const joinedEntry: PresenceEntry = {
        ...entry,
        connectionId: gid,
      };
      await client.publish(
        channelName(roomId),
        JSON.stringify({
          instanceId,
          message: {
            type: MSG_PRESENCE_UPDATED,
            payload: {
              roomId,
              joined: [joinedEntry],
            },
          } as ServerMessage,
        } as Envelope)
      );
    },

    async leaveRoom(roomId: string, connectionId: string): Promise<void> {
      const connections = localConnections.get(roomId);
      if (connections) {
        connections.delete(connectionId);
        if (connections.size === 0) localConnections.delete(roomId);
      }

      const gid = gConnId(connectionId);
      const key = presenceKey(roomId, gid);
      await client.zrem(membersKey(roomId), gid);
      await client.del(key);
      await client.publish(
        channelName(roomId),
        JSON.stringify({
          instanceId,
          message: {
            type: MSG_PRESENCE_UPDATED,
            payload: { roomId, left: [gid] },
          } as ServerMessage,
        } as Envelope)
      );
    },

    async updatePresence(roomId: string, entry: PresenceEntry): Promise<void> {
      const gid = gConnId(entry.connectionId);
      const key = presenceKey(roomId, gid);
      await client.hset(key, {
        userId: entry.userId ?? "",
        name: entry.name ?? "",
        email: entry.email ?? "",
        provider: entry.provider ?? "",
        presence: JSON.stringify(entry.presence ?? {}),
      });
      const updatedEntry: PresenceEntry = {
        ...entry,
        connectionId: gid,
      };
      await client.publish(
        channelName(roomId),
        JSON.stringify({
          instanceId,
          message: {
            type: MSG_PRESENCE_UPDATED,
            payload: {
              roomId,
              updated: [updatedEntry],
            },
          } as ServerMessage,
        } as Envelope)
      );
    },

    async getGlobalPresence(
      roomId: string
    ): Promise<Record<string, PresenceEntry>> {
      const members = await client.zrange(membersKey(roomId), 0, -1);
      const result: Record<string, PresenceEntry> = {};
      for (const gid of members) {
        const key = presenceKey(roomId, gid);
        const hash = await client.hgetall(key);
        if (Object.keys(hash).length > 0) {
          result[gid] = entryFromHash(gid, hash);
        }
      }
      return result;
    },

    async publish(roomId: string, message: ServerMessage): Promise<void> {
      await client.publish(
        channelName(roomId),
        JSON.stringify({ instanceId, message } as Envelope)
      );
    },

    async subscribe(
      roomId: string,
      handler: (message: ServerMessage) => void
    ): Promise<void> {
      const ch = channelName(roomId);
      if (subscriptions.has(ch)) {
        subscriptions.set(ch, handler);
        return;
      }
      subscriptions.set(ch, handler);
      await subscriber.subscribe(ch);
    },

    async unsubscribe(roomId: string): Promise<void> {
      const ch = channelName(roomId);
      if (!subscriptions.has(ch)) return;
      subscriptions.delete(ch);
      await subscriber.unsubscribe(ch);
    },

    // TODO: implement publishBinary / subscribeBinary for Yjs binary relay across instances.
    // Until these are added, Yjs CRDT sync will only work within a single server instance
    // when the Redis adapter is in use. See RoomAdapter interface for the required signatures.

    async close(): Promise<void> {
      clearInterval(heartbeatTimer);
      await Promise.all([client.quit(), subscriber.quit()]);
    },
  };

  const heartbeatTimer = setInterval(() => {
    runHeartbeat().catch(() => {});
  }, heartbeatIntervalMs);

  async function runHeartbeat() {
    const now = Date.now();
    for (const [roomId, connections] of localConnections.entries()) {
      if (connections.size === 0) continue;
      const mKey = membersKey(roomId);

      const pipe = client.multi();
      for (const connId of connections) {
        pipe.zadd(mKey, now, gConnId(connId));
      }
      await pipe.exec();

      const expired = await client.zrangebyscore(mKey, "-inf", now - heartbeatTtlMs);
      if (expired.length > 0) {
        const cleanupPipe = client.multi();
        cleanupPipe.zrem(mKey, ...expired);
        for (const gid of expired) {
          cleanupPipe.del(presenceKey(roomId, gid));
        }
        await cleanupPipe.exec();

        await client.publish(
          channelName(roomId),
          JSON.stringify({
            instanceId,
            message: {
              type: MSG_PRESENCE_UPDATED,
              payload: { roomId, left: expired },
            } as ServerMessage,
          } as Envelope)
        );
      }
    }
  }

  return adapter;
}
