import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { LibraryTrack } from "@/lib/libraryTrack";
import type { fetchRadio } from "@/lib/api";
import {
  clearUpcoming,
  orderWithNext,
  playNext,
  saveQueueAsPlaylist,
  smartShuffle,
  smartShuffleOrder,
} from "@/lib/queueActions";
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

  it("smart shuffle keeps what already played, shuffles the rest and slots a recommendation after every 3", () => {
    const [P, Q, R, S, T, U, V] = [
      "ppppppppppp",
      "qqqqqqqqqqq",
      "rrrrrrrrrrr",
      "sssssssssss",
      "ttttttttttt",
      "uuuuuuuuuuu",
      "vvvvvvvvvvv",
    ].map((id) => src(id));
    const rec1 = src("11111111111");
    const rec2 = src("22222222222");
    const order = smartShuffleOrder(
      [A, B, P, Q, R, S, T, U, rec1, rec2, V],
      B.url,
      new Set([rec1.url, rec2.url]),
      () => 0
    );

    expect(order.slice(0, 2)).toEqual([A, B]); // played + current stay put
    expect(order).toHaveLength(11);
    expect(new Set(order.map((s) => s.url)).size).toBe(11); // nothing lost or doubled
    expect([order[5], order[9]]).toEqual([rec1, rec2]); // after the 3rd and 6th of yours
  });

  it("smart shuffle adds recommendations from the playing song's radio, then reorders once they arrive", async () => {
    const reorder = spyOn(useGlobalStore.getState(), "broadcastReorder").mockImplementation(() => undefined);
    const radio = (id: string) => ({
      id,
      title: `Rec ${id}`,
      performer: { name: "Someone" },
      album: { image: { thumbnail: "" } },
    });
    const getRadio = mock(() =>
      // B is already queued, so it's skipped; 2 upcoming songs -> 1 recommendation
      Promise.resolve({ tracks: [radio("bbbbbbbbbbb"), radio("eeeeeeeeeee"), radio("fffffffffff")] })
    ) as unknown as typeof fetchRadio;

    const done = smartShuffle({ getRadio, random: () => 0.99 });
    await Bun.sleep(0);
    expect(getRadio).toHaveBeenCalledWith("aaaaaaaaaaa");
    expect(sent().map((m) => m.trackId)).toEqual(["eeeeeeeeeee"]);
    expect(reorder).not.toHaveBeenCalled(); // waits for the new song to show up

    const placeholder = src("eeeeeeeeeee", true);
    useGlobalStore.setState({ audioSources: [A, B, C, placeholder].map(asState) });
    await done;
    expect(reorder).toHaveBeenCalledTimes(1);
    const [newOrder] = reorder.mock.calls[0] as [ReturnType<typeof src>[]];
    expect(newOrder[0]).toEqual(A);
    expect(newOrder).toContainEqual(placeholder); // keeps its `preparing` flag
    expect(newOrder).toHaveLength(4);
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
