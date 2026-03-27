import { describe, it, expect, vi } from "vitest";
import * as Y from "yjs";
import * as encoding from "lib0/encoding";
import * as awarenessProtocol from "y-protocols/awareness";
import { LiveSyncYjsProvider } from "./yjs-provider.js";
import type { LiveSyncClient } from "./client.js";

const MSG_AWARENESS = 1;

function createAwarenessMessage(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MSG_AWARENESS);
  encoding.writeVarUint8Array(encoder, update);
  return encoding.toUint8Array(encoder);
}

describe("LiveSyncYjsProvider", () => {
  it("ignores malformed binary messages and keeps handling later messages", () => {
    let onBinary: ((data: Uint8Array) => void) | null = null;
    const sendBinary = vi.fn();
    const client: LiveSyncClient = {
      connect: () => {},
      disconnect: () => {},
      joinRoom: () => {},
      leaveRoom: () => {},
      updatePresence: () => {},
      broadcastEvent: () => {},
      sendChat: () => {},
      sendBinary,
      subscribeBinary: (listener) => {
        onBinary = listener;
        return () => {
          onBinary = null;
        };
      },
      getConnectionStatus: () => "open",
      getPresence: () => ({}),
      getChatMessages: () => [],
      getCurrentRoomId: () => "room-1",
      getState: () => ({
        connectionStatus: "open",
        currentRoomId: "room-1",
        connectionId: "c1",
        presence: {},
        chatMessages: [],
        lastError: null,
      }),
      subscribe: () => () => {},
    };

    const doc = new Y.Doc();
    const provider = new LiveSyncYjsProvider(doc, client, { awareness: true });
    provider.connect();
    expect(onBinary).not.toBeNull();

    // Malformed awareness message body should be swallowed.
    expect(() => onBinary!(new Uint8Array([MSG_AWARENESS]))).not.toThrow();

    const remoteDoc = new Y.Doc();
    const remoteAwareness = new awarenessProtocol.Awareness(remoteDoc);
    remoteAwareness.setLocalState({ name: "Alice" });
    const awarenessUpdate = awarenessProtocol.encodeAwarenessUpdate(remoteAwareness, [remoteDoc.clientID]);
    const validMessage = createAwarenessMessage(awarenessUpdate);

    expect(() => onBinary!(validMessage)).not.toThrow();
    expect(provider.awareness.getStates().get(remoteDoc.clientID)).toEqual({ name: "Alice" });
  });
});
