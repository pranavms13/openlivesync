/**
 * Manages one Y.Doc per room with persistence and awareness state.
 */

import * as Y from "yjs";
import type { YjsPersistence } from "./persistence.js";

export interface YjsDocStoreOptions {
  persistence?: YjsPersistence;
  gcEnabled?: boolean;
}

export class YjsDocStore {
  private readonly docs = new Map<string, Y.Doc>();
  private readonly awareness = new Map<string, Map<number, Uint8Array>>();
  readonly persistence: YjsPersistence | undefined;
  private readonly gcEnabled: boolean;

  constructor(options: YjsDocStoreOptions = {}) {
    this.persistence = options.persistence;
    this.gcEnabled = options.gcEnabled ?? true;
  }

  async getOrCreateDoc(roomId: string): Promise<Y.Doc> {
    let doc = this.docs.get(roomId);
    if (doc) return doc;

    doc = new Y.Doc();
    doc.gc = this.gcEnabled;
    this.docs.set(roomId, doc);

    if (this.persistence) {
      try {
        const saved = await this.persistence.loadDoc(roomId);
        if (saved) {
          Y.applyUpdate(doc, saved);
        }
      } catch (err) {
        console.error(`[openlivesync] Failed to load persisted Yjs doc for room "${roomId}":`, err);
      }
    }

    return doc;
  }

  async getStateVector(roomId: string): Promise<Uint8Array> {
    const doc = await this.getOrCreateDoc(roomId);
    return Y.encodeStateVector(doc);
  }

  async getStateDiff(roomId: string, remoteStateVector: Uint8Array): Promise<Uint8Array> {
    const doc = await this.getOrCreateDoc(roomId);
    return Y.encodeStateAsUpdate(doc, remoteStateVector);
  }

  getAwareness(roomId: string): Map<number, Uint8Array> {
    let map = this.awareness.get(roomId);
    if (!map) {
      map = new Map();
      this.awareness.set(roomId, map);
    }
    return map;
  }

  removeAwarenessStates(roomId: string, clientIds: number[]): void {
    const map = this.awareness.get(roomId);
    if (!map) return;
    for (const id of clientIds) {
      map.delete(id);
    }
  }

  destroyDoc(roomId: string): void {
    const doc = this.docs.get(roomId);
    if (doc) {
      doc.destroy();
      this.docs.delete(roomId);
    }
    this.awareness.delete(roomId);
  }
}
