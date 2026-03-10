import { describe, it, expect, vi, afterEach } from "vitest";
import { createLiveSyncClient } from "./client.js";

function createMockWebSocket() {
  const listeners = {};
  const sent = [];

  const ws = {
    readyState: 1,
    OPEN: 1,
    url: "",
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    addEventListener(type, listener) {
      listeners[type] = listeners[type] ?? [];
      listeners[type].push(listener);
    },
    send(data) {
      sent.push(data);
    },
    close() {
      if (typeof ws.onclose === "function") {
        ws.onclose({});
      }
      (listeners["close"] ?? []).forEach((l) => l({ data: "" }));
    },
    sent,
  };

  function emitOpen() {
    if (typeof ws.onopen === "function") {
      ws.onopen({});
    }
  }

  function emitMessage(msg) {
    const data = JSON.stringify(msg);
    if (typeof ws.onmessage === "function") {
      ws.onmessage({ data });
    }
    (listeners["message"] ?? []).forEach((l) => l({ data }));
  }

  return { ws, sent, emitOpen, emitMessage };
}

function installMockWebSocket(mock: ReturnType<typeof createMockWebSocket>) {
  const MockWS = vi.fn(() => mock.ws) as unknown as typeof WebSocket;
  (MockWS as unknown as Record<string, number>).OPEN = 1;
  (MockWS as unknown as Record<string, number>).CONNECTING = 0;
  (MockWS as unknown as Record<string, number>).CLOSING = 2;
  (MockWS as unknown as Record<string, number>).CLOSED = 3;
  globalThis.WebSocket = MockWS;
}

const flushMicrotasks = () => new Promise<void>((r) => setTimeout(r, 0));

describe("createLiveSyncClient joinRoom identity", () => {
  const OriginalWebSocket = globalThis.WebSocket;

  afterEach(() => {
    globalThis.WebSocket = OriginalWebSocket;
    vi.restoreAllMocks();
  });

  it("sends join_room with manual name/email when identity has no accessToken", async () => {
    const mock = createMockWebSocket();
    installMockWebSocket(mock);

    const client = createLiveSyncClient({ url: "ws://localhost/live", reconnect: false });
    client.connect();
    await flushMicrotasks();
    mock.emitOpen();

    const presence = { cursor: { x: 1, y: 2 } };
    const identity = { name: "Manual User", email: "manual@example.com" };

    client.joinRoom("room1", presence, identity);

    const raw = mock.sent[mock.sent.length - 1];
    expect(raw).toBeTruthy();
    const msg = JSON.parse(raw);
    expect(msg.type).toBe("join_room");
    expect(msg.payload).toMatchObject({
      roomId: "room1",
      presence,
      name: "Manual User",
      email: "manual@example.com",
    });
    expect(msg.payload.accessToken).toBeUndefined();
  });

  it("sends join_room with accessToken when identity has token only", async () => {
    const mock = createMockWebSocket();
    installMockWebSocket(mock);

    const client = createLiveSyncClient({ url: "ws://localhost/live", reconnect: false });
    client.connect();
    await flushMicrotasks();
    mock.emitOpen();

    const identity = { accessToken: "token-123" };
    client.joinRoom("room1", undefined, identity);

    const raw = mock.sent[mock.sent.length - 1];
    expect(raw).toBeTruthy();
    const msg = JSON.parse(raw);
    expect(msg.type).toBe("join_room");
    expect(msg.payload).toMatchObject({
      roomId: "room1",
      accessToken: "token-123",
    });
  });

  it("reconnectAndRejoin reuses last identity", async () => {
    const mock = createMockWebSocket();
    installMockWebSocket(mock);

    const client = createLiveSyncClient({ url: "ws://localhost/live", reconnect: false });
    client.connect();
    await flushMicrotasks();
    mock.emitOpen();

    const identity = {
      accessToken: "token-abc",
      name: "Reconnect User",
      email: "reconnect@example.com",
    };

    client.joinRoom("room-reconnect", { cursor: { x: 0 } }, identity);

    mock.emitMessage({
      type: "room_joined",
      payload: {
        roomId: "room-reconnect",
        connectionId: "c1",
        presence: {},
      },
    });

    // Simulate connection drop (not intentional disconnect, which clears room state)
    mock.ws.close();
    mock.sent.length = 0;
    client.connect();
    await flushMicrotasks();
    mock.emitOpen();

    const raw = mock.sent[mock.sent.length - 1];
    expect(raw).toBeTruthy();
    const msg = JSON.parse(raw);
    expect(msg.type).toBe("join_room");
    expect(msg.payload).toMatchObject({
      roomId: "room-reconnect",
      accessToken: "token-abc",
      name: "Reconnect User",
      email: "reconnect@example.com",
    });
  });
});

