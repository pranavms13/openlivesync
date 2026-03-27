/**
 * Yjs persistence interface and in-memory implementation.
 */

import * as Y from "yjs";

export interface YjsPersistence {
  loadDoc(roomId: string): Promise<Uint8Array | null>;
  storeUpdate(roomId: string, update: Uint8Array): Promise<void>;
  clearDoc(roomId: string): Promise<void>;
}

/**
 * In-memory persistence that merges updates into a single state snapshot.
 */
export function createInMemoryYjsPersistence(): YjsPersistence {
  const docs = new Map<string, Uint8Array>();

  return {
    async loadDoc(roomId: string): Promise<Uint8Array | null> {
      return docs.get(roomId) ?? null;
    },

    async storeUpdate(roomId: string, update: Uint8Array): Promise<void> {
      const existing = docs.get(roomId);
      if (existing) {
        // Merge existing state + new update into one snapshot
        const doc = new Y.Doc();
        Y.applyUpdate(doc, existing);
        Y.applyUpdate(doc, update);
        docs.set(roomId, Y.encodeStateAsUpdate(doc));
        doc.destroy();
      } else {
        docs.set(roomId, update);
      }
    },

    async clearDoc(roomId: string): Promise<void> {
      docs.delete(roomId);
    },
  };
}
