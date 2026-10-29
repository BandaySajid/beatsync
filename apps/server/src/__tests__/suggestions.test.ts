import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { mockR2 } from "@/__tests__/mocks/r2";
import { createMockServer } from "@/__tests__/mocks/websocket";
import { pickAutoQueueTrack, refreshSuggestions } from "@/lib/suggestions";
import { globalManager } from "@/managers/GlobalManager";
import type { RoomManager } from "@/managers/RoomManager";
import { YOUTUBE_MANAGER } from "@/managers/YoutubeManager";
import type { TrackType } from "@beatsync/shared";

mockR2();

const track = (id: string) => ({ id }) as TrackType;
const streamUrl = (id: string) => `/stream/youtube/${id}/Song☆abc.m4a`;

describe("auto-queue suggestions", () => {
  let room: RoomManager;

  beforeEach(async () => {
    for (const id of globalManager.getRoomIds()) globalManager.deleteRoom(id);
    room = globalManager.getOrCreateRoom("suggest-room");
    room.setAudioSources([{ url: streamUrl("aaaaaaaaaaa") }, { url: streamUrl("bbbbbbbbbbb") }]);
    // Radio includes a song that is already queued; it must be skipped.
    spyOn(YOUTUBE_MANAGER, "getSuggestions").mockResolvedValue([track("aaaaaaaaaaa"), track("ccccccccccc")]);
    spyOn(YOUTUBE_MANAGER, "prewarm").mockImplementation(() => undefined);
    await refreshSuggestions(room, createMockServer(), "bbbbbbbbbbb");
  });

  afterEach(() => {
    mock.restore();
  });

  it("queues the first unqueued suggestion only when the last track starts", () => {
    expect(pickAutoQueueTrack(room, streamUrl("aaaaaaaaaaa"))).toBeUndefined();
    expect(pickAutoQueueTrack(room, streamUrl("bbbbbbbbbbb"))?.id).toBe("ccccccccccc");
  });
});
