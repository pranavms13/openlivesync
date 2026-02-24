import { describe, it, expect } from "vitest";
import React, { type ReactNode } from "react";
import { renderHook, act } from "@testing-library/react";
import { LiveSyncProvider, useRoom } from "./react-entry.js";
import { createLiveSyncClient, type JoinRoomIdentity } from "./client.js";

describe("useRoom identity options", () => {
  it("join uses identity from options when no explicit identity is passed", () => {
    const joinSpy: { lastArgs?: [string, unknown, JoinRoomIdentity?] } = {};
    const client = createLiveSyncClient({ url: "ws://localhost/live", reconnect: false });
    // Monkey-patch joinRoom to capture calls
    (client as unknown as {
      joinRoom: (...args: [string, unknown, JoinRoomIdentity?]) => void;
    }).joinRoom = (...args: [string, unknown, JoinRoomIdentity?]) => {
      joinSpy.lastArgs = args;
    };

    const wrapper: React.FC<{ children: ReactNode }> = ({ children }) => (
      <LiveSyncProvider client={client}>{children}</LiveSyncProvider>
    );

    const { result } = renderHook(
      () => useRoom("room-hook", { name: "Hook User", email: "hook@example.com" }),
      { wrapper }
    );

    act(() => {
      result.current.join("room-hook");
    });

    expect(joinSpy.lastArgs).toBeDefined();
    const [, , identity] = joinSpy.lastArgs!;
    expect(identity).toMatchObject({
      name: "Hook User",
      email: "hook@example.com",
    });
  });
});

