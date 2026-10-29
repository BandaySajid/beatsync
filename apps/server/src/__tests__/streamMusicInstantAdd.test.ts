import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { mockR2 } from "@/__tests__/mocks/r2";
import { createMockServer, createMockWs } from "@/__tests__/mocks/websocket";
import { globalManager } from "@/managers/GlobalManager";
import { YOUTUBE_MANAGER } from "@/managers/YoutubeManager";
import { handleStreamMusic } from "@/websocket/handlers/handleStreamMusic";

mockR2();

describe("YouTube instant add", () => {
  afterEach(() => {
    (YOUTUBE_MANAGER.getStreamInfo as unknown as { mockRestore: () => void }).mockRestore();
  });

  it("queues before the stream resolves, and drops the track if resolution fails", async () => {
    for (const id of globalManager.getRoomIds()) globalManager.deleteRoom(id);
    const room = globalManager.getOrCreateRoom("instant-room");
    let fail!: (error: Error) => void;
    spyOn(YOUTUBE_MANAGER, "getStreamInfo").mockReturnValue(new Promise((_, reject) => (fail = reject)));

    const ws = createMockWs({ clientId: "c1", roomId: "instant-room" });
    await handleStreamMusic({
      ws,
      message: { type: "STREAM_MUSIC", trackId: "nMozMETeCyw", trackName: "Artist - Song" },
      server: createMockServer(),
    });
    expect(room.getAudioSources().map((s) => s.url)[0]).toStartWith("/stream/youtube/nMozMETeCyw/");

    fail(new Error("bot check failed"));
    await Bun.sleep(0);
    expect(room.getAudioSources()).toHaveLength(0);
  });
});
