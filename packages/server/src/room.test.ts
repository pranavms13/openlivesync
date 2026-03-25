import { describe, it, expect } from "vitest";
import * as encoding from "lib0/encoding";
import { Room } from "./room.js";
import { RoomManager } from "./room-manager.js";
import { createInMemoryChatStorage } from "./storage/in-memory.js";
import { YjsDocStore } from "./yjs/doc-store.js";
import { createAwarenessRemovalMessage } from "./yjs/handler.js";
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

function createAwarenessUpdateMessage(clientId: number, clock: number, stateJson: string): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 1); // MSG_AWARENESS
  const content = encoding.createEncoder();
  encoding.writeVarUint(content, 1); // count
  encoding.writeVarUint(content, clientId);
  encoding.writeVarUint(content, clock);
  encoding.writeVarString(content, stateJson);
  encoding.writeVarUint8Array(encoder, encoding.toUint8Array(content));
  return encoding.toUint8Array(encoder);
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

  it("join sends room_joined with empty chatHistory when getHistory throws", async () => {
    const failingStorage = {
      append: async () => {},
      getHistory: async () => {
        throw new Error("storage unavailable");
      },
    } as import("./storage/chat-storage.js").ChatStorage;
    const room = new Room({
      roomId: "r1",
      chatStorage: failingStorage,
      historyLimit: 10,
    });
    const { handle, sent } = mockHandle("c1");
    await room.join(handle);
    expect(sent).toHaveLength(1);
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

  it("updatePresence with unknown connectionId does nothing", async () => {
    const storage = createInMemoryChatStorage();
    const room = new Room({ roomId: "r1", chatStorage: storage, historyLimit: 10 });
    const { handle, sent } = mockHandle("c1");
    await room.join(handle);
    sent.length = 0;
    room.updatePresence("unknown-connection", { x: 1 });
    expect(sent).toHaveLength(0);
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

  it("cleans up tracked awareness states and broadcasts removals on leave", async () => {
    const storage = createInMemoryChatStorage();
    const yjsDocStore = new YjsDocStore();
    const room = new Room({
      roomId: "r1",
      chatStorage: storage,
      historyLimit: 10,
      yjsDocStore,
    });

    const sentBinary1: Uint8Array[] = [];
    const sentBinary2: Uint8Array[] = [];
    const { handle: h1 } = mockHandle("c1");
    const { handle: h2 } = mockHandle("c2");
    h1.sendBinary = (data) => sentBinary1.push(data);
    h2.sendBinary = (data) => sentBinary2.push(data);

    await room.join(h1);
    await room.join(h2);

    const awarenessMsg = createAwarenessUpdateMessage(42, 1, "{\"name\":\"alice\"}");
    room.handleYjsMessage("c1", awarenessMsg);
    await Promise.resolve();

    expect(yjsDocStore.getAwareness("r1").has(42)).toBe(true);

    sentBinary1.length = 0;
    sentBinary2.length = 0;

    room.leave("c1");

    expect(yjsDocStore.getAwareness("r1").has(42)).toBe(false);
    expect(sentBinary1).toHaveLength(0);
    expect(sentBinary2).toEqual([createAwarenessRemovalMessage([42])]);
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
