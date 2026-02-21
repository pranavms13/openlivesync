import { describe, it, expect } from "vitest";
import {
  MSG_JOIN_ROOM,
  MSG_LEAVE_ROOM,
  MSG_UPDATE_PRESENCE,
  MSG_BROADCAST_EVENT,
  MSG_SEND_CHAT,
  MSG_ROOM_JOINED,
  MSG_PRESENCE_UPDATED,
  MSG_CHAT_MESSAGE,
  MSG_ERROR,
} from "./protocol.js";

describe("protocol constants", () => {
  it("client message types are string constants", () => {
    expect(MSG_JOIN_ROOM).toBe("join_room");
    expect(MSG_LEAVE_ROOM).toBe("leave_room");
    expect(MSG_UPDATE_PRESENCE).toBe("update_presence");
    expect(MSG_BROADCAST_EVENT).toBe("broadcast_event");
    expect(MSG_SEND_CHAT).toBe("send_chat");
  });

  it("server message types are string constants", () => {
    expect(MSG_ROOM_JOINED).toBe("room_joined");
    expect(MSG_PRESENCE_UPDATED).toBe("presence_updated");
    expect(MSG_CHAT_MESSAGE).toBe("chat_message");
    expect(MSG_ERROR).toBe("error");
  });
});
