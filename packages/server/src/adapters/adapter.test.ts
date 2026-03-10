import { describe, it, expect, vi } from "vitest";
import { Room } from "../room.js";
import { createInMemoryChatStorage } from "../storage/in-memory.js";
import type { RoomAdapter } from "./adapter.js";
import type { PresenceEntry, ServerMessage } from "../protocol.js";
import {
  MSG_ROOM_JOINED,
  MSG_PRESENCE_UPDATED,
  MSG_CHAT_MESSAGE,
  MSG_BROADCAST_EVENT_RELAY,
} from "../protocol.js";

function mockHandle(
  connectionId: string,
  sent: { value: unknown[] } = { value: [] }
): { handle: import("../room.js").RoomConnectionHandle; sent: unknown[] } {
  return {
    handle: {
      connectionId,
      presence: {},
      send: (msg: unknown) => sent.value.push(msg),
    },
    sent: sent.value,
  };
}

describe("Room with adapter", () => {
  it("join uses adapter joinRoom, getGlobalPresence, and subscribe", async () => {
    const storage = createInMemoryChatStorage({ historyLimit: 10 });
    const joinRoom = vi.fn().mockResolvedValue(undefined);
    const getGlobalPresence = vi.fn().mockResolvedValue({
      "inst1:c1": {
        connectionId: "inst1:c1",
        presence: { cursor: { x: 0 } },
      },
    } as Record<string, PresenceEntry>);
    const subscribe = vi.fn().mockResolvedValue(undefined);
    const adapter: RoomAdapter = {
      instanceId: "inst1",
      joinRoom,
      leaveRoom: vi.fn().mockResolvedValue(undefined),
      updatePresence: vi.fn().mockResolvedValue(undefined),
      getGlobalPresence,
      publish: vi.fn().mockResolvedValue(undefined),
      subscribe,
      unsubscribe: vi.fn().mockResolvedValue(undefined),
    };
    const room = new Room({
      roomId: "r1",
      chatStorage: storage,
      historyLimit: 10,
      adapter,
    });
    const { handle, sent } = mockHandle("c1");
    await room.join(handle, { cursor: { x: 0 } });

    expect(joinRoom).toHaveBeenCalledWith("r1", {
      connectionId: "c1",
      userId: undefined,
      name: undefined,
      email: undefined,
      provider: undefined,
      presence: { cursor: { x: 0 } },
    });
    expect(getGlobalPresence).toHaveBeenCalledWith("r1");
    expect(subscribe).toHaveBeenCalledWith("r1", expect.any(Function));
    expect(sent).toHaveLength(1);
    expect((sent[0] as { type: string }).type).toBe(MSG_ROOM_JOINED);
    expect((sent[0] as { payload: { connectionId: string } }).payload.connectionId).toBe(
      "inst1:c1"
    );
    expect((sent[0] as { payload: { presence: Record<string, unknown> } }).payload.presence).toEqual({
      "inst1:c1": {
        connectionId: "inst1:c1",
        presence: { cursor: { x: 0 } },
      },
    });
  });

  it("leave calls adapter leaveRoom and unsubscribe when last connection", async () => {
    const storage = createInMemoryChatStorage();
    const leaveRoom = vi.fn().mockResolvedValue(undefined);
    const unsubscribe = vi.fn().mockResolvedValue(undefined);
    const adapter: RoomAdapter = {
      instanceId: "inst1",
      joinRoom: vi.fn().mockResolvedValue(undefined),
      leaveRoom,
      updatePresence: vi.fn().mockResolvedValue(undefined),
      getGlobalPresence: vi.fn().mockResolvedValue({}),
      publish: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn().mockResolvedValue(undefined),
      unsubscribe,
    };
    const room = new Room({
      roomId: "r1",
      chatStorage: storage,
      historyLimit: 10,
      adapter,
    });
    const { handle } = mockHandle("c1");
    await room.join(handle);
    room.leave("c1");

    expect(leaveRoom).toHaveBeenCalledWith("r1", "c1");
    expect(unsubscribe).toHaveBeenCalledWith("r1");
  });

  it("updatePresence calls adapter and broadcasts with gConnId", async () => {
    const storage = createInMemoryChatStorage();
    const updatePresence = vi.fn().mockResolvedValue(undefined);
    const adapter: RoomAdapter = {
      instanceId: "inst1",
      joinRoom: vi.fn().mockResolvedValue(undefined),
      leaveRoom: vi.fn().mockResolvedValue(undefined),
      updatePresence,
      getGlobalPresence: vi.fn().mockResolvedValue({}),
      publish: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn().mockResolvedValue(undefined),
      unsubscribe: vi.fn().mockResolvedValue(undefined),
    };
    const room = new Room({
      roomId: "r1",
      chatStorage: storage,
      historyLimit: 10,
      adapter,
   });
   const { handle: h1 } = mockHandle("c1");
   const { handle: h2, sent: s2 } = mockHandle("c2");
   await room.join(h1);
    await room.join(h2);
    s2.length = 0;
    await room.updatePresence("c1", { cursor: { x: 5 } });

    expect(updatePresence).toHaveBeenCalledWith("r1", {
      connectionId: "c1",
      userId: undefined,
      name: undefined,
      email: undefined,
      provider: undefined,
      presence: { cursor: { x: 5 } },
    });
    expect(s2[0]).toMatchObject({
      type: MSG_PRESENCE_UPDATED,
      payload: {
        roomId: "r1",
        updated: [{ connectionId: "inst1:c1", presence: { cursor: { x: 5 } } }],
      },
    });
  });

  it("broadcastEvent and sendChat call adapter.publish", async () => {
    const storage = createInMemoryChatStorage();
    const publish = vi.fn().mockResolvedValue(undefined);
    const adapter: RoomAdapter = {
      instanceId: "inst1",
      joinRoom: vi.fn().mockResolvedValue(undefined),
      leaveRoom: vi.fn().mockResolvedValue(undefined),
      updatePresence: vi.fn().mockResolvedValue(undefined),
      getGlobalPresence: vi.fn().mockResolvedValue({}),
      publish,
      subscribe: vi.fn().mockResolvedValue(undefined),
      unsubscribe: vi.fn().mockResolvedValue(undefined),
    };
    const room = new Room({
      roomId: "r1",
      chatStorage: storage,
      historyLimit: 10,
      adapter,
    });
    const { handle: h1 } = mockHandle("c1");
    const { handle: h2 } = mockHandle("c2");
    await room.join(h1);
    await room.join(h2);
    publish.mockClear();
    await room.broadcastEvent("c1", "draw", { x: 1 }, "u1");
    expect(publish).toHaveBeenCalledWith(
      "r1",
      expect.objectContaining({
        type: MSG_BROADCAST_EVENT_RELAY,
        payload: expect.objectContaining({
          roomId: "r1",
          connectionId: "inst1:c1",
          userId: "u1",
          event: "draw",
          payload: { x: 1 },
        }),
      })
    );
    publish.mockClear();
    await room.sendChat("c1", "hi", undefined, "u1");
    expect(publish).toHaveBeenCalledWith(
      "r1",
      expect.objectContaining({
        type: MSG_CHAT_MESSAGE,
        payload: expect.objectContaining({
          roomId: "r1",
          connectionId: "inst1:c1",
          message: "hi",
          userId: "u1",
        }),
      })
    );
  });

  it("relays messages from adapter subscribe to local connections", async () => {
    const storage = createInMemoryChatStorage();
    let subHandler: (msg: ServerMessage) => void = () => {};
    const adapter: RoomAdapter = {
      instanceId: "inst1",
      joinRoom: vi.fn().mockResolvedValue(undefined),
      leaveRoom: vi.fn().mockResolvedValue(undefined),
      updatePresence: vi.fn().mockResolvedValue(undefined),
      getGlobalPresence: vi.fn().mockResolvedValue({}),
      publish: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn().mockImplementation(async (_roomId, handler) => {
        subHandler = handler;
      }),
      unsubscribe: vi.fn().mockResolvedValue(undefined),
    };
    const room = new Room({
      roomId: "r1",
      chatStorage: storage,
      historyLimit: 10,
      adapter,
    });
    const { handle: h1, sent: s1 } = mockHandle("c1");
    const { handle: h2, sent: s2 } = mockHandle("c2");
    await room.join(h1);
    await room.join(h2);
    s1.length = 0;
    s2.length = 0;
    subHandler({
      type: MSG_PRESENCE_UPDATED,
      payload: { roomId: "r1", joined: [{ connectionId: "inst2:c3", presence: {} }] },
    });
    expect(s1).toHaveLength(1);
    expect(s2).toHaveLength(1);
    expect(s1[0]).toMatchObject({
      type: MSG_PRESENCE_UPDATED,
      payload: { roomId: "r1", joined: [{ connectionId: "inst2:c3", presence: {} }] },
    });
  });
});

describe("createRedisAdapter", () => {
  it("throws when url and client/subscriber are missing", async () => {
    const { createRedisAdapter } = await import("./redis.js");
    await expect(createRedisAdapter({})).rejects.toThrow(/Redis adapter requires/);
  });

  it("runs heartbeat and cleans up stale entries", async () => {
    const { createRedisAdapter } = await import("./redis.js");
    const pub: { channel: string; message: string }[] = [];
    const keys: Record<string, { score: number; member: string }[]> = {};
    const mockClient = {
      zadd: vi.fn(async (key: string, score: number, member: string) => { keys[key] = keys[key] || []; keys[key].push({ score, member }); return 1; }),
      zrangebyscore: vi.fn(async () => ["inst1:c2"]),
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      zrem: vi.fn(async (_key: string, ..._members: string[]) => 1),
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      del: vi.fn(async (_key: string) => 1),
      publish: vi.fn(async (channel: string, message: string) => { pub.push({ channel, message }); return 1; }),
      multi: vi.fn(() => {
        const p = {
          sadd: () => p,
          zadd: (key: string, score: number, member: string) => { mockClient.zadd(key, score, member); return p; },
          zrem: (key: string, ...members: string[]) => { mockClient.zrem(key, ...members); return p; },
          del: (key: string) => { mockClient.del(key); return p; },
          hset: (key: string, object: Record<string, string>) => { mockClient.hset(key, object); return p; },
          exec: () => mockClient.exec(),
        };
        return p;
      }),
      exec: vi.fn(async () => []),
      quit: vi.fn(async () => "OK"),
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      hset: vi.fn(async (_key: string, _object: Record<string, string>) => 1),
      on: vi.fn(),
      subscribe: vi.fn(async () => {}),
      unsubscribe: vi.fn(async () => {}),
      sadd: vi.fn(async () => 1),
      srem: vi.fn(async () => 1),
      smembers: vi.fn(async () => []),
      hgetall: vi.fn(async () => ({})),
      zrange: vi.fn(async () => [])
    };
    const mockSubscriber = { ...mockClient };
    const adapter = await createRedisAdapter({
      client: mockClient as unknown as import("./redis.js").RedisClientLike,
      subscriber: mockSubscriber as unknown as import("./redis.js").RedisClientLike,
      heartbeatIntervalMs: 50,
      heartbeatTtlMs: 100,
    });

    await adapter.joinRoom("r1", { connectionId: "c1", presence: {} });

    // Wait for heartbeat
    await new Promise((resolve) => setTimeout(resolve, 60));
    
    expect(mockClient.zadd).toHaveBeenCalled();
    expect(mockClient.zrangebyscore).toHaveBeenCalled();
    expect(mockClient.zrem).toHaveBeenCalledWith("room:r1:members", "inst1:c2");
    expect(mockClient.del).toHaveBeenCalledWith("room:r1:presence:inst1:c2");
    expect(mockClient.publish).toHaveBeenCalled();
    expect(pub[1].message).toContain("left");
    expect(pub[1].message).toContain("inst1:c2");

    await adapter.close!();
  });
});
