import { describe, it, expect } from "vitest";
import { Room } from "./room.js";
import { RoomManager } from "./room-manager.js";
import { createInMemoryChatStorage } from "./storage/in-memory.js";
import { MSG_ROOM_JOINED, MSG_PRESENCE_UPDATED, MSG_CHAT_MESSAGE, MSG_BROADCAST_EVENT_RELAY } from "./protocol.js";

function mockHandle(
  connectionId: string,
  userId?: string,
  sent: { value: unknown[] } = { value: [] }
): { handle: import("./room.js").RoomConnectionHandle; sent: unknown[] } {
  const list = sent.value;
  return {
    handle: {
      connectionId,
      userId,
      presence: {},
      send: (msg: unknown) => list.push(msg),
    },
    sent: list,
  };
}

describe("Room", () => {
  it("join sends room_joined with presence and chat history", async () => {
    const storage = createInMemoryChatStorage({ historyLimit: 10 });
    const room = new Room({
      roomId: "r1",
      chatStorage: storage,
      historyLimit: 10,
    });
    const { handle, sent } = mockHandle("c1", "u1");
    await room.join(handle, { cursor: { x: 1, y: 2 } });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: MSG_ROOM_JOINED,
      payload: {
        roomId: "r1",
        connectionId: "c1",
        presence: { c1: { connectionId: "c1", userId: "u1", presence: { cursor: { x: 1, y: 2 } } } },
      },
    });
    expect((sent[0] as { payload: { chatHistory?: unknown[] } }).payload.chatHistory).toEqual([]);
  });

  it("leave broadcasts presence_updated with left", async () => {
    const storage = createInMemoryChatStorage();
    const room = new Room({ roomId: "r1", chatStorage: storage, historyLimit: 10 });
    const { handle: h1, sent: s1 } = mockHandle("c1");
    const { handle: h2, sent: s2 } = mockHandle("c2");
    await room.join(h1);
    await room.join(h2);
    s1.length = 0;
    s2.length = 0;
    room.leave("c1");
    expect(s1).toHaveLength(0);
    expect(s2).toHaveLength(1);
    expect(s2[0]).toMatchObject({
      type: MSG_PRESENCE_UPDATED,
      payload: { roomId: "r1", left: ["c1"] },
    });
  });

  it("updatePresence broadcasts to others only", async () => {
    const storage = createInMemoryChatStorage();
    const room = new Room({ roomId: "r1", chatStorage: storage, historyLimit: 10 });
    const { handle: h1, sent: s1 } = mockHandle("c1");
    const { handle: h2, sent: s2 } = mockHandle("c2");
    await room.join(h1);
    await room.join(h2);
    s1.length = 0;
    s2.length = 0;
    room.updatePresence("c1", { cursor: { x: 10 } });
    expect(s1).toHaveLength(0);
    expect(s2).toHaveLength(1);
    expect(s2[0]).toMatchObject({
      type: MSG_PRESENCE_UPDATED,
      payload: { roomId: "r1", updated: [{ connectionId: "c1", presence: { cursor: { x: 10 } } }] },
    });
  });

  it("broadcastEvent relays to others only", async () => {
    const storage = createInMemoryChatStorage();
    const room = new Room({ roomId: "r1", chatStorage: storage, historyLimit: 10 });
    const { handle: h1, sent: s1 } = mockHandle("c1");
    const { handle: h2, sent: s2 } = mockHandle("c2");
    await room.join(h1);
    await room.join(h2);
    s1.length = 0;
    s2.length = 0;
    room.broadcastEvent("c1", "draw", { x: 1, y: 2 }, "u1");
    expect(s1).toHaveLength(0);
    expect(s2).toHaveLength(1);
    expect(s2[0]).toMatchObject({
      type: MSG_BROADCAST_EVENT_RELAY,
      payload: { roomId: "r1", connectionId: "c1", userId: "u1", event: "draw", payload: { x: 1, y: 2 } },
    });
  });

  it("sendChat appends to storage and broadcasts to all", async () => {
    const storage = createInMemoryChatStorage();
    const room = new Room({ roomId: "r1", chatStorage: storage, historyLimit: 10 });
    const { handle: h1, sent: s1 } = mockHandle("c1", "u1");
    const { handle: h2, sent: s2 } = mockHandle("c2");
    await room.join(h1);
    await room.join(h2);
    s1.length = 0;
    s2.length = 0;
    await room.sendChat("c1", "hello", { replyTo: "x" }, "u1");
    expect(s1).toHaveLength(1);
    expect(s2).toHaveLength(1);
    expect(s1[0]).toMatchObject({
      type: MSG_CHAT_MESSAGE,
      payload: { roomId: "r1", connectionId: "c1", userId: "u1", message: "hello", metadata: { replyTo: "x" } },
    });
    const history = await storage.getHistory("r1");
    expect(history).toHaveLength(1);
    expect(history[0].message).toBe("hello");
  });
});

describe("RoomManager", () => {
  it("getOrCreate returns same room for same id", () => {
    const storage = createInMemoryChatStorage();
    const manager = new RoomManager({ chatStorage: storage, historyLimit: 10 });
    const a = manager.getOrCreate("r1");
    const b = manager.getOrCreate("r1");
    expect(a).toBe(b);
  });

  it("get returns undefined for unknown room", () => {
    const storage = createInMemoryChatStorage();
    const manager = new RoomManager({ chatStorage: storage, historyLimit: 10 });
    expect(manager.get("r1")).toBeUndefined();
  });

  it("removeIfEmpty removes room when no connections", async () => {
    const storage = createInMemoryChatStorage();
    const manager = new RoomManager({ chatStorage: storage, historyLimit: 10 });
    const room = manager.getOrCreate("r1");
    const { handle } = mockHandle("c1");
    await room.join(handle);
    room.leave("c1");
    manager.removeIfEmpty("r1");
    expect(manager.get("r1")).toBeUndefined();
  });
});
