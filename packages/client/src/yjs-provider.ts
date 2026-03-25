/**
 * Yjs provider that syncs a Y.Doc over LiveSyncClient binary frames.
 * Follows the y-websocket wire format (byte 0: 0=sync, 1=awareness).
 */

import { Observable } from "lib0/observable";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import type { LiveSyncClient } from "./client.js";

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;

export interface LiveSyncYjsProviderOptions {
  awareness?: boolean;
}

export class LiveSyncYjsProvider extends Observable<string> {
  readonly doc: Y.Doc;
  readonly awareness: awarenessProtocol.Awareness;
  private readonly client: LiveSyncClient;
  private readonly awarenessEnabled: boolean;
  private connected = false;
  private unsubBinary: (() => void) | null = null;
  private readonly _docUpdateHandler: (update: Uint8Array, origin: unknown) => void;
  private readonly _awarenessUpdateHandler: (
    changes: { added: number[]; updated: number[]; removed: number[] },
    origin: string | null
  ) => void;

  constructor(
    doc: Y.Doc,
    client: LiveSyncClient,
    options: LiveSyncYjsProviderOptions = {}
  ) {
    super();
    this.doc = doc;
    this.client = client;
    this.awarenessEnabled = options.awareness !== false;
    this.awareness = new awarenessProtocol.Awareness(doc);

    this._docUpdateHandler = (update: Uint8Array, origin: unknown) => {
      if (origin === this) return; // don't echo remote updates
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MSG_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      this.client.sendBinary(encoding.toUint8Array(encoder));
    };

    this._awarenessUpdateHandler = (
      changes: { added: number[]; updated: number[]; removed: number[] },
    ) => {
      const changedClients = changes.added.concat(changes.updated, changes.removed);
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MSG_AWARENESS);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients)
      );
      this.client.sendBinary(encoding.toUint8Array(encoder));
    };
  }

  connect(): void {
    if (this.connected) return;
    this.connected = true;

    // Subscribe to binary messages from server
    this.unsubBinary = this.client.subscribeBinary((data: Uint8Array) => {
      this._handleServerMessage(data);
    });

    // Listen for local doc updates
    this.doc.on("update", this._docUpdateHandler);

    // Listen for awareness changes
    if (this.awarenessEnabled) {
      this.awareness.on("update", this._awarenessUpdateHandler);
    }

    // Initiate sync: send sync step 1 (our state vector)
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    this.client.sendBinary(encoding.toUint8Array(encoder));

    // Send initial awareness state
    if (this.awarenessEnabled) {
      const awarenessEncoder = encoding.createEncoder();
      encoding.writeVarUint(awarenessEncoder, MSG_AWARENESS);
      encoding.writeVarUint8Array(
        awarenessEncoder,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.doc.clientID])
      );
      this.client.sendBinary(encoding.toUint8Array(awarenessEncoder));
    }

    this.emit("status", [{ status: "connected" }]);
  }

  disconnect(): void {
    if (!this.connected) return;
    this.connected = false;

    if (this.unsubBinary) {
      this.unsubBinary();
      this.unsubBinary = null;
    }

    this.doc.off("update", this._docUpdateHandler);

    if (this.awarenessEnabled) {
      this.awareness.off("update", this._awarenessUpdateHandler);
      // Remove local awareness state
      awarenessProtocol.removeAwarenessStates(
        this.awareness,
        [this.doc.clientID],
        "disconnect"
      );
    }

    this.emit("status", [{ status: "disconnected" }]);
  }

  destroy(): void {
    this.disconnect();
    this.awareness.destroy();
    super.destroy();
  }

  private _handleServerMessage(data: Uint8Array): void {
    try {
      const decoder = decoding.createDecoder(data);
      const messageType = decoding.readVarUint(decoder);

      if (messageType === MSG_SYNC) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MSG_SYNC);
        const syncMessageType = syncProtocol.readSyncMessage(
          decoder,
          encoder,
          this.doc,
          this // origin = this provider, so _docUpdateHandler skips it
        );

        // If encoder has a reply (sync step 2 response), send it
        if (encoding.length(encoder) > 1) {
          this.client.sendBinary(encoding.toUint8Array(encoder));
        }

        if (syncMessageType === 0 || syncMessageType === 1 || syncMessageType === 2) {
          this.emit("synced", [true]);
        }
      } else if (messageType === MSG_AWARENESS) {
        const awarenessData = decoding.readVarUint8Array(decoder);
        awarenessProtocol.applyAwarenessUpdate(this.awareness, awarenessData, this);
      }
    } catch {
      // Ignore malformed binary payloads from server and keep provider alive.
    }
  }
}
