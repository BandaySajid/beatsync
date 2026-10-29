import { describe, expect, spyOn, test } from "bun:test";
import { YoutubeManager } from "@/managers/YoutubeManager";

describe("YoutubeManager.prewarm", () => {
  test("downloads only the top pick and resolves the next two", () => {
    const manager = new YoutubeManager();
    const preload = spyOn(manager, "preloadVideo").mockResolvedValue(null);
    const resolve = spyOn(manager, "getStreamInfo").mockRejectedValue(new Error("offline"));

    manager.prewarm(["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc", "ddddddddddd"]);

    expect(preload.mock.calls).toEqual([["aaaaaaaaaaa"]]);
    expect(resolve.mock.calls.map(([id]) => id)).toEqual(["bbbbbbbbbbb", "ccccccccccc"]);
  });
});

describe("YoutubeManager.getVideoId", () => {
  test.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=abc", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?t=42", "dQw4w9WgXcQ"],
    ["https://youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtube.com/live/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
  ])("extracts %s", (url, expected) => {
    expect(YoutubeManager.getVideoId(url)).toBe(expected);
  });

  test("rejects non-YouTube URLs", () => {
    expect(YoutubeManager.getVideoId("https://example.com/watch?v=dQw4w9WgXcQ")).toBeNull();
  });

  test("rejects malformed YouTube video IDs", () => {
    expect(YoutubeManager.getVideoId("https://youtube.com/watch?v=too-short")).toBeNull();
  });
});

describe("YoutubeManager stream URLs", () => {
  test("builds a display-friendly stream path", () => {
    const url = YoutubeManager.getStreamUrl("dQw4w9WgXcQ", "Artist / Title");
    expect(url.startsWith("/stream/youtube/dQw4w9WgXcQ/")).toBe(true);
    expect(url).toContain(encodeURIComponent("Artist - Title"));
    expect(url.endsWith(".m4a")).toBe(true);
  });

  test("recognizes stream URLs for backup restore", () => {
    expect(YoutubeManager.isStreamUrl("/stream/youtube/dQw4w9WgXcQ/Title___abc.m4a")).toBe(true);
    expect(YoutubeManager.isStreamUrl("https://example.com/stream/youtube/dQw4w9WgXcQ/title.m4a")).toBe(true);
    expect(YoutubeManager.isStreamUrl("/room-123/song.mp3")).toBe(false);
    expect(YoutubeManager.isStreamUrl("not a url")).toBe(false);
  });
});
