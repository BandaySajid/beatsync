import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { createMockWs } from "@/__tests__/mocks/websocket";
import { YOUTUBE_MANAGER, YoutubeManager } from "@/managers/YoutubeManager";
import { handleImportPlaylist } from "@/websocket/handlers/handleImportPlaylist";
import type { BunServer } from "@/utils/websocket";
import type { WSUnicastType } from "@beatsync/shared";

// Record unicasts here: other test files mock.module this module with no-op senders.
let unicasts: WSUnicastType[] = [];
void mock.module("@/utils/responses", () => ({
  sendUnicast: mock(({ message }: { message: WSUnicastType }) => {
    unicasts.push(message);
  }),
  sendBroadcast: mock(() => undefined),
  sendToClient: mock(() => undefined),
  corsHeaders: {},
  jsonResponse: mock(() => new Response()),
  errorResponse: mock(() => new Response()),
}));

// Current YouTube shape (LockupView), as returned by youtubei.js for a playlist page.
const lockup = (id: string, title: string, channel: string, length: string) => ({
  type: "LockupView",
  content_id: id,
  content_type: "VIDEO",
  metadata: {
    title: { text: title },
    metadata: { metadata_rows: [{ metadata_parts: [{ text: { text: channel } }] }] },
  },
  content_image: { overlays: [{ badges: [{ text: length }] }] },
});

describe("YouTube playlist import", () => {
  afterEach(() => {
    unicasts = [];
    mock.restore();
  });

  it("finds the playlist ID in YouTube and YouTube Music links", () => {
    expect(
      YoutubeManager.getPlaylistId("https://www.youtube.com/playlist?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI")
    ).toBe("PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI");
    expect(YoutubeManager.getPlaylistId("https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabcdefghij")).toBe(
      "PLabcdefghij"
    );
    expect(YoutubeManager.getPlaylistId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(YoutubeManager.getPlaylistId("https://example.com/playlist?list=PLabcdefghij")).toBeNull();
  });

  it("reads LockupView and PlaylistVideo items across continuation pages", async () => {
    const manager = new YoutubeManager();
    const page2 = {
      items: [
        {
          type: "PlaylistVideo",
          id: "9bZkp7q19f0",
          title: { text: "Gangnam Style" },
          author: { name: "PSY" },
          duration: { seconds: 253 },
        },
      ],
      has_continuation: false,
    };
    const page1 = {
      info: { title: "Party mix" },
      items: [lockup("dQw4w9WgXcQ", "Never Gonna Give You Up", "Rick Astley", "3:33"), { type: "ContinuationItem" }],
      has_continuation: true,
      getContinuation: () => Promise.resolve(page2),
    };
    spyOn(manager as unknown as { getInnertube: () => Promise<unknown> }, "getInnertube").mockResolvedValue({
      getPlaylist: () => Promise.resolve(page1),
    });

    const { name, tracks } = await manager.getPlaylist("PLabcdefghij");
    expect(name).toBe("Party mix");
    expect(tracks.map((t) => [t.id, t.title, t.performer.name, t.duration])).toEqual([
      ["dQw4w9WgXcQ", "Never Gonna Give You Up", "Rick Astley", 213],
      ["9bZkp7q19f0", "Gangnam Style", "PSY", 253],
    ]);
  });

  it("replies to the requester with the playlist, or a readable error", async () => {
    spyOn(YOUTUBE_MANAGER, "getPlaylist").mockResolvedValue({
      name: "Party mix",
      tracks: [{ id: "dQw4w9WgXcQ" }] as Awaited<ReturnType<typeof YOUTUBE_MANAGER.getPlaylist>>["tracks"],
    });
    const ws = createMockWs({ clientId: "me" });
    const server = {} as BunServer;
    const url = "https://www.youtube.com/playlist?list=PLabcdefghij";

    await handleImportPlaylist({ ws, server, message: { type: "IMPORT_PLAYLIST", url } });
    await handleImportPlaylist({
      ws,
      server,
      message: { type: "IMPORT_PLAYLIST", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
    });

    expect(unicasts[0]).toMatchObject({
      type: "PLAYLIST_IMPORT_RESPONSE",
      url,
      response: { type: "success", name: "Party mix" },
    });
    expect(unicasts[1]).toMatchObject({ response: { type: "error" } });
  });
});
