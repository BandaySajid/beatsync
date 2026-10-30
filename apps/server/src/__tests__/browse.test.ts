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

  it("names the real artists of a browsed playlist, not the label that uploaded the songs", async () => {
    const manager = new YoutubeManager();
    stubInnertube(manager, {
      music: {
        getPlaylist: () =>
          Promise.resolve({
            header: { title: { text: "Bollywood Sufi Essentials" } },
            items: [
              {
                id: "6rvUyBiBtik",
                title: "Tera Mera Rishta",
                authors: [{ name: "Mustafa Zahid" }, { name: "Pritam" }],
                duration: { seconds: 372 },
              },
            ],
            has_continuation: false,
          }),
      },
      // The regular playlist page credits the uploading channel.
      getPlaylist: () =>
        Promise.resolve({
          info: { title: "Bollywood Sufi Essentials" },
          items: [lockup("6rvUyBiBtik", "Tera Mera Rishta", "Sony Music India")],
          has_continuation: false,
        }),
    });

    const { name, tracks } = await manager.getBrowsePlaylist("RDCLAK5uy_kVxH0ivTOBmqTAELKt2mmhDWyEpZyBxJA");
    expect(name).toBe("Bollywood Sufi Essentials");
    expect(tracks.map((t) => [t.title, t.performer.name, t.duration])).toEqual([
      ["Tera Mera Rishta", "Mustafa Zahid", 372],
    ]);
  });

  it("finds a song's artist page only when the name really matches", async () => {
    const manager = new YoutubeManager();
    const artist = (name: string, id: string) => ({ item_type: "artist", id, name });
    const search = mock((query: string) =>
      Promise.resolve({
        contents: [
          {
            is: () => true, // a MusicShelf
            contents:
              query === "Sony Music India"
                ? [artist("Bollywood Instrumentals", "UCaaaaaaaaaaaaaaaaaaaaaa")]
                : [artist("Jagjit Singh", "UCh1u7At1I9kU2BDncDcYIXQ")],
          },
        ],
      })
    );
    stubInnertube(manager, { music: { search } });

    expect(await manager.findArtistId("JAGJIT SINGH - Topic")).toBe("UCh1u7At1I9kU2BDncDcYIXQ");
    expect(search.mock.calls[0][0]).toBe("JAGJIT SINGH"); // " - Topic" channels are named after the artist
    // A label's channel: the top search result is some other artist, so no page.
    expect(await manager.findArtistId("Sony Music India")).toBeNull();
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
