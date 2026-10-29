import { beforeEach, describe, expect, it, mock } from "bun:test";
import { mockR2 } from "@/__tests__/mocks/r2";
import { createMockServer, createMockWs } from "@/__tests__/mocks/websocket";
import { globalManager } from "@/managers/GlobalManager";
import { handleUploadComplete } from "@/routes/upload";
import { handleWebSocketUpgrade } from "@/routes/websocket";
import type { BunServer } from "@/utils/websocket";

mockR2();

const ROOM_ID = "123456";

// Whether the connection was upgraded. (Other test files mock.module the response helpers,
// and Bun shares module mocks across files, so status codes aren't reliable here.)
const connect = (clientId: string, clientSecret: string) => {
  const upgrade = mock(() => true);
  const url = `http://localhost/ws?roomId=${ROOM_ID}&username=u&clientId=${clientId}&clientSecret=${clientSecret}`;
  handleWebSocketUpgrade(new Request(url), { upgrade } as unknown as BunServer);
  return upgrade.mock.calls.length > 0;
};

describe("client ID ownership", () => {
  beforeEach(() => {
    for (const id of globalManager.getRoomIds()) globalManager.deleteRoom(id);
  });

  it("refuses a known clientId (e.g. the admin's, which every member sees) without its secret", () => {
    const room = globalManager.getOrCreateRoom(ROOM_ID);
    room.addClient(createMockWs({ clientId: "admin", clientSecret: "real-secret", roomId: ROOM_ID }));
    room.removeClient("admin"); // admin's data (incl. isAdmin) stays cached for rejoin

    expect(connect("admin", "guessed")).toBe(false);
    expect(connect("admin", "real-secret")).toBe(true);
    expect(connect("newcomer", "anything")).toBe(true);
  });
});

describe("upload completion", () => {
  beforeEach(() => {
    for (const id of globalManager.getRoomIds()) globalManager.deleteRoom(id);
    globalManager.getOrCreateRoom(ROOM_ID);
  });

  const complete = (publicUrl: string) =>
    handleUploadComplete(
      new Request("http://localhost/upload/complete", {
        method: "POST",
        body: JSON.stringify({ roomId: ROOM_ID, originalName: "x.mp3", publicUrl }),
      }),
      createMockServer()
    );

  it("only queues files from this room's R2 folder", async () => {
    // mockR2's getPublicUrlForKey maps keys to https://cdn.example.com/<key>
    await complete("https://evil.example.com/track.mp3");
    await complete("https://cdn.example.com/room-999999/track.mp3");
    await complete(`https://cdn.example.com/room-${ROOM_ID}/track.mp3`);
    expect(globalManager.getRoom(ROOM_ID)?.getAudioSources()).toEqual([
      { url: `https://cdn.example.com/room-${ROOM_ID}/track.mp3` },
    ]);
  });
});
