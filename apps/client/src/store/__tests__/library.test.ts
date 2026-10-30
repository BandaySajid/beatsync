import { beforeEach, describe, expect, it, mock } from "bun:test";
import { isTrackQueued, queueLibraryTrack, trackFromQueueUrl, type LibraryTrack } from "@/lib/libraryTrack";
import { useGlobalStore } from "@/store/global";
import { useLibraryStore } from "@/store/library";

const SONG: LibraryTrack = { id: "dQw4w9WgXcQ", title: "Never Gonna Give You Up", artist: "Rick Astley" };

describe("on-device library: liked songs", () => {
  beforeEach(() => {
    localStorage.clear();
    useLibraryStore.setState({ liked: [] });
  });

  it("toggles a like and saves it in this browser", () => {
    useLibraryStore.getState().toggleLike(SONG);
    expect(useLibraryStore.getState().liked).toEqual([SONG]);
    expect(JSON.parse(localStorage.getItem("beatsync:library-v1")!).state.liked).toEqual([SONG]);

    useLibraryStore.getState().toggleLike(SONG);
    expect(useLibraryStore.getState().liked).toEqual([]);
  });

  it("can save queued YouTube songs (preparing or in R2) but not one-room uploads", () => {
    const stream = "/stream/youtube/dQw4w9WgXcQ/Rick%20Astley%20-%20Never%20Gonna%20Give%20You%20Up___x.m4a";
    expect(trackFromQueueUrl(stream)).toMatchObject(SONG);
    expect(trackFromQueueUrl("https://cdn.example.com/youtube/dQw4w9WgXcQ/Song___yt.m4a")?.id).toBe("dQw4w9WgXcQ");
    expect(trackFromQueueUrl("https://cdn.example.com/room-123456/my-upload___123.mp3")).toBeNull();
  });

  it("re-adds a saved song with the same request as search, and knows when it is queued", () => {
    const send = mock<(data: string) => void>(() => undefined);
    useGlobalStore.setState({
      socket: { readyState: WebSocket.OPEN, send } as unknown as WebSocket,
      audioSources: [],
    });

    expect(isTrackQueued(SONG)).toBe(false);
    queueLibraryTrack(SONG);
    expect(JSON.parse(send.mock.calls[0][0])).toEqual({
      type: "STREAM_MUSIC",
      trackId: "dQw4w9WgXcQ",
      trackName: "Rick Astley - Never Gonna Give You Up",
    });

    useGlobalStore.setState({
      audioSources: [{ source: { url: "/stream/youtube/dQw4w9WgXcQ/x___y.m4a" }, status: "idle" }],
    });
    expect(isTrackQueued(SONG)).toBe(true);
  });
});
