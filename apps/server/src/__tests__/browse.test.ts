import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { YoutubeManager } from "@/managers/YoutubeManager";

const stubInnertube = (manager: YoutubeManager, innertube: object) =>
  spyOn(manager as unknown as { getInnertube: () => Promise<unknown> }, "getInnertube").mockResolvedValue(innertube);

const lockup = (id: string, title: string, channel: string) => ({
  type: "LockupView",
  content_id: id,
  content_type: "VIDEO",
  metadata: {
    title: { text: title },
    metadata: { metadata_rows: [{ metadata_parts: [{ text: { text: channel } }] }] },
  },
});

describe("YouTube Music browsing", () => {
  afterEach(() => {
    mock.restore();
  });

  it("opens YouTube Music's curated playlists (RDCLAK…) but still refuses Mixes", async () => {
    const manager = new YoutubeManager();
    stubInnertube(manager, {
      getPlaylist: () =>
        Promise.resolve({
          info: { title: "Coffee Shop Blend" },
          items: [lockup("H-zVEnHB3_g", "Lord Huron - Your Other Life", "Lord Huron")],
          has_continuation: false,
        }),
    });

    const { tracks } = await manager.getBrowsePlaylist("RDCLAK5uy_nBE4bLuBHUXWZrF59ZrkPEToKt8M_I3Vc");
    // Music video titles repeat the artist; it's already the performer.
    expect(tracks.map((t) => [t.title, t.performer.name])).toEqual([["Your Other Life", "Lord Huron"]]);
    const refused = await manager.getPlaylist("RDdQw4w9WgXcQ").catch((error: Error) => error.message);
    expect(refused).toContain("Mixes");
  });

  it("shares one fetch per browse page, but doesn't keep a failed one", async () => {
    const manager = new YoutubeManager();
    const execute = mock()
      .mockRejectedValueOnce(new Error("YouTube hiccup"))
      .mockResolvedValue({ contents_memo: { getType: () => [] } });
    stubInnertube(manager, { actions: { execute } });

    expect(await manager.getMoods().catch((error: Error) => error.message)).toBe("YouTube hiccup");
    await Promise.all([manager.getMoods(), manager.getMoods()]);
    await manager.getMoods();
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
