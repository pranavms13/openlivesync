/**
 * React hooks for Yjs integration with LiveSync.
 * Import from "@openlivesync/client/yjs-react".
 */

import { useEffect, useMemo, useState } from "react";
import * as Y from "yjs";
import { LiveSyncYjsProvider, type LiveSyncYjsProviderOptions } from "./yjs-provider.js";
import { useLiveSyncClient } from "./react-entry.js";

export type UseYDocOptions = LiveSyncYjsProviderOptions;

export interface UseYDocReturn {
  doc: Y.Doc;
  provider: LiveSyncYjsProvider;
}

/**
 * Creates and manages a Y.Doc + LiveSyncYjsProvider for a given room.
 * Connects when the room is joined and disconnects on cleanup.
 */
export function useYDoc(
  roomId: string | null,
  options: UseYDocOptions = {}
): UseYDocReturn {
  const client = useLiveSyncClient();
  const awareness = options.awareness;

  const { doc, provider } = useMemo(() => {
    const doc = new Y.Doc();
    const provider = new LiveSyncYjsProvider(doc, client, { awareness });
    return { doc, provider };
  }, [client, awareness]);

  useEffect(() => {
    if (!roomId) return;
    provider.connect();
    return () => {
      provider.disconnect();
    };
  }, [roomId, provider]);

  useEffect(() => {
    return () => {
      provider.destroy();
      doc.destroy();
    };
  }, [doc, provider]);

  return { doc, provider };
}

/**
 * Returns the current awareness states as a reactive Map.
 * Re-renders when awareness changes.
 */
export function useAwareness(
  provider: LiveSyncYjsProvider
): Map<number, Record<string, unknown>> {
  const [states, setStates] = useState<Map<number, Record<string, unknown>>>(
    () => new Map(provider.awareness.getStates() as Map<number, Record<string, unknown>>)
  );

  useEffect(() => {
    const handler = () => {
      setStates(new Map(provider.awareness.getStates() as Map<number, Record<string, unknown>>));
    };
    provider.awareness.on("change", handler);
    return () => {
      provider.awareness.off("change", handler);
    };
  }, [provider]);

  return states;
}

/**
 * Access the LiveSyncYjsProvider instance directly (convenience hook).
 */
export function useYjsProvider(
  roomId: string | null,
  options: UseYDocOptions = {}
): LiveSyncYjsProvider {
  return useYDoc(roomId, options).provider;
}
