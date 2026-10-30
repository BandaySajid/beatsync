import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { LibraryTrack } from "@/lib/libraryTrack";
import { clearUpcoming, orderWithNext, playNext, saveQueueAsPlaylist } from "@/lib/queueActions";
import { useGlobalStore } from "@/store/global";
import { useLibraryStore } from "@/store/library";

const src = (id: string, preparing?: boolean) => ({
  url: `/stream/youtube/${id}/Artist%20-%20Song%20${id}___x.m4a`,
  ...(preparing ? { preparing } : {}),
});
const asState = (source: ReturnType<typeof src>) => ({ source, status: "idle" as const });
const A = src("aaaaaaaaaaa");
const B = src("bbbbbbbbbbb");
const C = src("ccccccccccc");
const D: LibraryTrack = { id: "ddddddddddd", title: "Song D", artist: "Artist" };

// Spied store actions get copied into every later state object, so put the real one back.
const { broadcastReorder } = useGlobalStore.getState();

describe("queue actions", () => {
  const send = mock<(data: string) => void>(() => undefined);
  const sent = () => send.mock.calls.map(([data]) => JSON.parse(data) as Record<string, unknown>);

  beforeEach(() => {
    send.mockClear();
    useLibraryStore.setState({ playlists: [] });
    useGlobalStore.setState({
      socket: { readyState: WebSocket.OPEN, send } as unknown as WebSocket,
      audioSources: [A, B, C].map(asState),
      selectedAudioUrl: A.url,
    });
  });

  afterEach(() => {
    mock.restore();
    useGlobalStore.setState({ broadcastReorder });
  });

  it("moves a song to right after the current one", () => {
    expect(orderWithNext([A, B, C], C.url, A.url)).toEqual([A, C, B]);
    expect(orderWithNext([A, B, C], C.url, "")).toEqual([C, A, B]); // nothing selected: front
    expect(orderWithNext([A, B, C], A.url, A.url)).toEqual([A, B, C]); // the current song stays
  });

  it("adds a new song, then moves it next once the server's placeholder (still preparing) appears", () => {
    const reorder = spyOn(useGlobalStore.getState(), "broadcastReorder").mockImplementation(() => undefined);
    playNext(D);
    expect(sent()[0]).toMatchObject({ type: "STREAM_MUSIC", trackId: D.id });

    const placeholder = src(String(D.id), true);
    useGlobalStore.setState({ audioSources: [A, B, C, placeholder].map(asState) });
    // Moved right after A, and keeps its `preparing` flag.
    expect(reorder).toHaveBeenCalledWith([A, placeholder, B, C]);
  });

  it("clears everything except the current song, and saves the queue as a playlist", () => {
    clearUpcoming();
    expect(sent()[0]).toEqual({ type: "DELETE_AUDIO_SOURCES", urls: [B.url, C.url] });

    expect(saveQueueAsPlaylist()).toBe(3);
    expect(useLibraryStore.getState().playlists[0].tracks.map((t) => t.id)).toEqual([
      "aaaaaaaaaaa",
      "bbbbbbbbbbb",
      "ccccccccccc",
    ]);
  });
});
