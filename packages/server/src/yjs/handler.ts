/**
 * Binary message handler for Yjs sync and awareness protocols.
 *
 * Wire format (y-websocket convention):
 * - Byte 0 = 0: Yjs sync message
 * - Byte 0 = 1: Awareness message
 */

import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import * as syncProtocol from "y-protocols/sync";
import type { YjsDocStore } from "./doc-store.js";

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;

export interface YjsHandlerResult {
  /** Messages to send back to the originating client. */
  reply: Uint8Array[];
  /** Messages to broadcast to all OTHER clients in the room. */
  broadcast: Uint8Array[];
  /** Awareness client IDs observed as active in this message. */
  awarenessClientIdsAdded: number[];
  /** Awareness client IDs observed as removed in this message. */
  awarenessClientIdsRemoved: number[];
}

export async function handleYjsBinaryMessage(
  roomId: string,
  _connectionId: string,
  data: Uint8Array,
  docStore: YjsDocStore
): Promise<YjsHandlerResult> {
  const result: YjsHandlerResult = {
    reply: [],
    broadcast: [],
    awarenessClientIdsAdded: [],
    awarenessClientIdsRemoved: [],
  };

  const decoder = decoding.createDecoder(data);
  const messageType = decoding.readVarUint(decoder);

  if (messageType === MSG_SYNC) {
    // Peek ahead: if this is a sync update (type 2) and persistence is enabled,
    // extract the raw update bytes now before readSyncMessage advances the decoder.
    let updateForPersistence: Uint8Array | null = null;
    if (docStore.persistence) {
      const peekDecoder = decoding.createDecoder(data);
      decoding.readVarUint(peekDecoder); // skip MSG_SYNC
      if (decoding.readVarUint(peekDecoder) === 2) {
        updateForPersistence = decoding.readVarUint8Array(peekDecoder);
      }
    }

    const doc = await docStore.getOrCreateDoc(roomId);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_SYNC);
    const syncMessageType = syncProtocol.readSyncMessage(decoder, encoder, doc, null);

    // If the encoder has content beyond the message type prefix, send it back
    if (encoding.length(encoder) > 1) {
      result.reply.push(encoding.toUint8Array(encoder));
    }

    // syncMessageType 2 = update — broadcast to others and persist
    if (syncMessageType === 2) {
      // The update was already applied to the doc by readSyncMessage.
      // Re-broadcast the original message to other clients.
      result.broadcast.push(data);

      if (updateForPersistence) {
        await docStore.persistence!.storeUpdate(roomId, updateForPersistence);
      }
    }
  } else if (messageType === MSG_AWARENESS) {
    // Awareness: always relay to other clients first (pure broadcast).
    result.broadcast.push(data);

    // Best-effort: parse and store awareness state server-side for cleanup on disconnect.
    try {
      const awarenessData = decoding.readVarUint8Array(decoder);
      const awarenessMap = docStore.getAwareness(roomId);
      const awarenessDecoder = decoding.createDecoder(awarenessData);
      const count = decoding.readVarUint(awarenessDecoder);
      for (let i = 0; i < count; i++) {
        const clientId = decoding.readVarUint(awarenessDecoder);
        const clock = decoding.readVarUint(awarenessDecoder);
        const state = decoding.readVarString(awarenessDecoder);
        if (state === "null" || clock === 0) {
          awarenessMap.delete(clientId);
          result.awarenessClientIdsRemoved.push(clientId);
        } else {
          const entryEncoder = encoding.createEncoder();
          encoding.writeVarUint(entryEncoder, clientId);
          encoding.writeVarUint(entryEncoder, clock);
          encoding.writeVarString(entryEncoder, state);
          awarenessMap.set(clientId, encoding.toUint8Array(entryEncoder));
          result.awarenessClientIdsAdded.push(clientId);
        }
      }
    } catch {
      // Parsing failure is non-fatal; the message was already queued for broadcast.
    }
  }

  return result;
}

/**
 * Build a sync step 1 message (server's state vector) to initiate handshake.
 */
export async function createSyncStep1Message(
  roomId: string,
  docStore: YjsDocStore
): Promise<Uint8Array> {
  const doc = await docStore.getOrCreateDoc(roomId);
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MSG_SYNC);
  syncProtocol.writeSyncStep1(encoder, doc);
  return encoding.toUint8Array(encoder);
}

/**
 * Build an awareness removal message for the given client IDs.
 */
export function createAwarenessRemovalMessage(clientIds: number[]): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MSG_AWARENESS);

  // Build awareness content
  const contentEncoder = encoding.createEncoder();
  encoding.writeVarUint(contentEncoder, clientIds.length);
  for (const clientId of clientIds) {
    encoding.writeVarUint(contentEncoder, clientId);
    encoding.writeVarUint(contentEncoder, 0); // clock = 0 means removal
    encoding.writeVarString(contentEncoder, "null");
  }

  encoding.writeVarUint8Array(encoder, encoding.toUint8Array(contentEncoder));
  return encoding.toUint8Array(encoder);
}
