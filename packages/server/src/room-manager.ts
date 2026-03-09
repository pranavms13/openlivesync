/**
 * Manages rooms: get-or-create by roomId.
 */

import { Room } from "./room.js";
import type { ChatStorage } from "./storage/chat-storage.js";
import type { RoomAdapter } from "./adapters/adapter.js";

export interface RoomManagerOptions {
  chatStorage: ChatStorage;
  historyLimit: number;
  adapter?: RoomAdapter;
}

export class RoomManager {
  private readonly options: RoomManagerOptions;
  private readonly rooms = new Map<string, Room>();

  constructor(options: RoomManagerOptions) {
    this.options = options;
  }

  getOrCreate(roomId: string): Room {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = new Room({
        roomId,
        chatStorage: this.options.chatStorage,
        historyLimit: this.options.historyLimit,
        adapter: this.options.adapter,
      });
      this.rooms.set(roomId, room);
    }
    return room;
  }

  get(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  /** Remove room when empty (optional cleanup). */
  removeIfEmpty(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (room && room.connectionCount === 0) {
      this.rooms.delete(roomId);
    }
  }
}
