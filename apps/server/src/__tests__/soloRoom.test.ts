import { beforeEach, describe, expect, it, mock, type Mock } from "bun:test";
import { mockR2 } from "@/__tests__/mocks/r2";
import { createMockServer, createMockWs } from "@/__tests__/mocks/websocket";
import { BackupManager } from "@/managers/BackupManager";
import { globalManager } from "@/managers/GlobalManager";
import type { RoomBackupType } from "@/managers/RoomManager";
import { handleWebSocketUpgrade } from "@/routes/websocket";
import { handleOpen } from "@/routes/websocketHandlers";
import type { BunServer, WSData } from "@/utils/websocket";
import { PRIVATE_ROOM_CLOSE_CODE } from "@beatsync/shared";

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
    // Invite links shared before the restart keep working.
    expect(globalManager.getRoom("444444")?.getInviteToken()).toBe(backup.inviteToken);
  });
});

describe("solo rooms are join-by-invite", () => {
  beforeEach(() => {
    for (const id of globalManager.getRoomIds()) globalManager.deleteRoom(id);
  });

  // The upgrade decides `denied`; capture the data it would open the socket with.
  const upgradeData = (roomId: string, clientId: string, invite?: string) => {
    let data: WSData | undefined;
    const server = {
      upgrade: mock((_req: Request, options: { data: WSData }) => {
        data = options.data;
        return true;
      }),
    } as unknown as BunServer;
    const url = `http://localhost/ws?roomId=${roomId}&username=u&clientId=${clientId}&clientSecret=secret-${clientId}${invite ? `&invite=${invite}` : ""}`;
    handleWebSocketUpgrade(new Request(url), server);
    return data!;
  };

  it("refuses someone with just the room link, lets in invitees and the owner", () => {
    const room = join("555555", "owner", true);
    const token = room.getInviteToken()!;
    expect(token.length).toBeGreaterThanOrEqual(32);

    expect(upgradeData("555555", "stranger").denied).toBe(true); // e.g. the owner's URL in incognito
    expect(upgradeData("555555", "stranger", "wrong-token").denied).toBe(true);
    expect(upgradeData("555555", "friend", token).denied).toBe(false);
    expect(upgradeData("555555", "owner").denied).toBe(false); // reconnecting member
    expect(upgradeData("666666", "anyone").denied).toBe(false); // rooms that don't exist yet
    join("777777", "host", false);
    expect(upgradeData("777777", "anyone").denied).toBe(false); // public rooms are unchanged
  });

  it("closes a denied socket with the private-room code without joining it to the room", () => {
    const room = join("888888", "owner", true);
    const ws = createMockWs({ clientId: "stranger", roomId: "888888" });
    ws.data.denied = true;

    handleOpen(ws, createMockServer());

    expect((ws.close as unknown as Mock<(code: number, reason: string) => void>).mock.calls).toEqual([
      [PRIVATE_ROOM_CLOSE_CODE, "This is a private session"],
    ]);
    expect((ws.subscribe as unknown as Mock<() => void>).mock.calls).toHaveLength(0);
    expect(room.getClients().map((client) => client.clientId)).toEqual(["owner"]);
  });
});
