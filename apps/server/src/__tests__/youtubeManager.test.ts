import { describe, expect, test } from "bun:test";
import { YoutubeManager } from "@/managers/YoutubeManager";

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
