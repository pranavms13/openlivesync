/**
 * Yjs CRDT integration module — barrel exports.
 */

export { YjsDocStore, type YjsDocStoreOptions } from "./doc-store.js";
export {
  type YjsPersistence,
  createInMemoryYjsPersistence,
} from "./persistence.js";
export {
  handleYjsBinaryMessage,
  createSyncStep1Message,
  createAwarenessRemovalMessage,
  type YjsHandlerResult,
} from "./handler.js";
