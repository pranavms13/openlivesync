import { describe, it, expect } from "vitest";
import { createInMemoryChatStorage } from "./in-memory.js";

describe("createInMemoryChatStorage", () => {
  it("appends messages and returns them oldest first", async () => {
    const storage = createInMemoryChatStorage({ historyLimit: 10 });
    await storage.append("room1", {
      roomId: "room1",
      connectionId: "c1",
      message: "first",
    });
    await storage.append("room1", {
      roomId: "room1",
      connectionId: "c2",
      message: "second",
    });
    const history = await storage.getHistory("room1");
    expect(history).toHaveLength(2);
    expect(history[0].message).toBe("first");
    expect(history[1].message).toBe("second");
    expect(history[0].connectionId).toBe("c1");
    expect(history[1].connectionId).toBe("c2");
  });

  it("respects limit", async () => {
    const storage = createInMemoryChatStorage({ historyLimit: 100 });
    for (let i = 0; i < 5; i++) {
      await storage.append("room1", {
        roomId: "room1",
        connectionId: "c1",
        message: `msg${i}`,
      });
    }
    const all = await storage.getHistory("room1", 100);
    expect(all).toHaveLength(5);
    const limited = await storage.getHistory("room1", 2);
    expect(limited).toHaveLength(2);
    expect(limited[0].message).toBe("msg0");
    expect(limited[1].message).toBe("msg1");
  });

  it("respects offset for pagination", async () => {
    const storage = createInMemoryChatStorage({ historyLimit: 100 });
    for (let i = 0; i < 5; i++) {
      await storage.append("room1", {
        roomId: "room1",
        connectionId: "c1",
        message: `msg${i}`,
      });
    }
    const page = await storage.getHistory("room1", 2, 2);
    expect(page).toHaveLength(2);
    expect(page[0].message).toBe("msg2");
    expect(page[1].message).toBe("msg3");
  });

  it("returns empty for unknown room", async () => {
    const storage = createInMemoryChatStorage();
    const history = await storage.getHistory("nonexistent");
    expect(history).toEqual([]);
  });

  it("keeps at most historyLimit messages per room", async () => {
    const storage = createInMemoryChatStorage({ historyLimit: 3 });
    for (let i = 0; i < 5; i++) {
      await storage.append("room1", {
        roomId: "room1",
        connectionId: "c1",
        message: `msg${i}`,
      });
    }
    const history = await storage.getHistory("room1", 10);
    expect(history).toHaveLength(3);
    expect(history.map((m) => m.message)).toEqual(["msg2", "msg3", "msg4"]);
  });

  it("isolates rooms", async () => {
    const storage = createInMemoryChatStorage({ historyLimit: 10 });
    await storage.append("room1", {
      roomId: "room1",
      connectionId: "c1",
      message: "in room1",
    });
    await storage.append("room2", {
      roomId: "room2",
      connectionId: "c1",
      message: "in room2",
    });
    const h1 = await storage.getHistory("room1");
    const h2 = await storage.getHistory("room2");
    expect(h1).toHaveLength(1);
    expect(h2).toHaveLength(1);
    expect(h1[0].message).toBe("in room1");
    expect(h2[0].message).toBe("in room2");
  });
});
