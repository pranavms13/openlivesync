// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import React, { type ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { createLiveSyncClient } from "./client.js";
import { LiveSyncProvider } from "./react-entry.js";
import { useYDoc } from "./yjs-react.js";

describe("useYDoc", () => {
  it("recreates doc/provider when options change", () => {
    const client = createLiveSyncClient({ url: "ws://localhost/live", reconnect: false });
    const wrapper: React.FC<{ children: ReactNode }> = ({ children }) => (
      <LiveSyncProvider client={client}>{children}</LiveSyncProvider>
    );

    const { result, rerender } = renderHook(
      ({ awareness }: { awareness?: boolean }) => useYDoc("room-1", { awareness }),
      {
        wrapper,
        initialProps: { awareness: true },
      }
    );

    const firstDoc = result.current.doc;
    const firstProvider = result.current.provider;

    rerender({ awareness: false });

    expect(result.current.doc).not.toBe(firstDoc);
    expect(result.current.provider).not.toBe(firstProvider);
  });

  it("does not recreate doc/provider for equivalent options", () => {
    const client = createLiveSyncClient({ url: "ws://localhost/live", reconnect: false });
    const wrapper: React.FC<{ children: ReactNode }> = ({ children }) => (
      <LiveSyncProvider client={client}>{children}</LiveSyncProvider>
    );

    const { result, rerender } = renderHook(
      ({ awareness }: { awareness?: boolean }) => useYDoc("room-1", { awareness }),
      {
        wrapper,
        initialProps: { awareness: true },
      }
    );

    const firstDoc = result.current.doc;
    const firstProvider = result.current.provider;

    rerender({ awareness: true });

    expect(result.current.doc).toBe(firstDoc);
    expect(result.current.provider).toBe(firstProvider);
  });
});
