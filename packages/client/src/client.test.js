import { describe, it, expect, vi } from "vitest";
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

describe("createLiveSyncClient joinRoom identity", () => {
  const OriginalWebSocket = globalThis.WebSocket;

  afterEach(() => {
    globalThis.WebSocket = OriginalWebSocket;
    vi.restoreAllMocks();
  });

  it("sends join_room with manual name/email when identity has no accessToken", () => {
    const mock = createMockWebSocket();
    globalThis.WebSocket = vi.fn(() => mock.ws);

    const client = createLiveSyncClient({ url: "ws://localhost/live", reconnect: false });
    client.connect();
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

  it("sends join_room with accessToken when identity has token only", () => {
    const mock = createMockWebSocket();
    globalThis.WebSocket = vi.fn(() => mock.ws);

    const client = createLiveSyncClient({ url: "ws://localhost/live", reconnect: false });
    client.connect();
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

  it("reconnectAndRejoin reuses last identity", () => {
    const mock = createMockWebSocket();
    globalThis.WebSocket = vi.fn(() => mock.ws);

    const client = createLiveSyncClient({ url: "ws://localhost/live", reconnect: false });
    client.connect();
    mock.emitOpen();

    const identity = {
      accessToken: "token-abc",
      name: "Reconnect User",
      email: "reconnect@example.com",
    };

    client.joinRoom("room-reconnect", { cursor: { x: 0 } }, identity);

    // Simulate server confirming join so client state has currentRoomId set
    mock.emitMessage({
      type: "room_joined",
      payload: {
        roomId: "room-reconnect",
        connectionId: "c1",
        presence: {},
      },
    });

    // Clear previous sends and trigger reconnectAndRejoin via connect() call again
    mock.sent.length = 0;
    client.connect();
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
}

