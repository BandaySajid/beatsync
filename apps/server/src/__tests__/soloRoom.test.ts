import { beforeEach, describe, expect, it } from "bun:test";
import { mockR2 } from "@/__tests__/mocks/r2";
import { createMockServer, createMockWs } from "@/__tests__/mocks/websocket";
import { BackupManager } from "@/managers/BackupManager";
import { globalManager } from "@/managers/GlobalManager";
import type { RoomBackupType } from "@/managers/RoomManager";
import { handleOpen } from "@/routes/websocketHandlers";

mockR2();

const AUDIO_URL = "https://example.com/song.mp3";

// Join through the real open handler, then make the room count as "playing" for /discover.
const join = (roomId: string, clientId: string, privateRoom: boolean) => {
  handleOpen(createMockWs({ clientId, roomId, privateRoom }), createMockServer());
  const room = globalManager.getRoom(roomId)!;
  if (room.getAudioSources().length === 0) room.addAudioSource({ url: AUDIO_URL });
  room.processNTPRequestFrom({ clientId });
  room.updatePlaybackSchedulePlay({ type: "PLAY", audioSource: AUDIO_URL, trackTimeSeconds: 0 }, Date.now());
  return room;
};

const discoverIds = () => globalManager.getActiveRooms().map((room) => room.roomId);

describe("solo (private) rooms", () => {
  beforeEach(() => {
    for (const id of globalManager.getRoomIds()) globalManager.deleteRoom(id);
  });

  it("keeps a solo session out of /discover, even after a friend joins", () => {
    join("111111", "me", true);
    join("222222", "someone", false);
    expect(discoverIds()).toEqual(["222222"]);

    join("111111", "friend", false); // invited friend joins with a plain link
    expect(discoverIds()).toEqual(["222222"]);
  });

  it("only lets the connection that creates a room make it private", () => {
    join("333333", "host", false);
    join("333333", "late", true);
    expect(globalManager.getRoom("333333")?.getIsPrivate()).toBe(false);
  });

  it("stays private across a backup/restore", async () => {
    const backup: RoomBackupType = join("444444", "me", true).createBackup();
    expect(backup.isPrivate).toBe(true);

    globalManager.deleteRoom("444444");
    // restoreRoom is private; exercise the real restore path for one room.
    await (
      BackupManager as unknown as { restoreRoom: (id: string, data: RoomBackupType) => Promise<unknown> }
    ).restoreRoom("444444", backup);
    expect(globalManager.getRoom("444444")?.getIsPrivate()).toBe(true);
  });
});
