import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { LibraryTrack } from "@/lib/libraryTrack";
import { resumeSession, snapshotSession, tracksToRestore } from "@/lib/session";
import { useGlobalStore } from "@/store/global";
import { HISTORY_LIMIT, useLibraryStore, type LastSession } from "@/store/library";

const track = (n: number): LibraryTrack => ({
  id: `video${String(n).padStart(6, "0")}`,
  title: `Song ${n}`,
  artist: "A",
});
const streamUrl = (t: LibraryTrack, preparing = false) => ({
  source: { url: `/stream/youtube/${t.id}/A%20-%20${encodeURIComponent(t.title)}___x.m4a`, preparing },
  status: "idle" as const,
});

// Spied store actions get copied into every later state object, so put the real ones back.
const { changeAudioSource, broadcastPlay, getCurrentTrackPosition } = useGlobalStore.getState();

describe("recently played", () => {
  beforeEach(() => useLibraryStore.setState({ history: [] }));

  it("keeps the newest first, without duplicates, up to the limit", () => {
    const { recordPlayed } = useLibraryStore.getState();
    recordPlayed(track(1));
    recordPlayed(track(2));
    recordPlayed(track(1)); // played again: moves to the top
    expect(useLibraryStore.getState().history.map((t) => t.title)).toEqual(["Song 1", "Song 2"]);

    for (let n = 3; n < HISTORY_LIMIT + 10; n++) recordPlayed(track(n));
    expect(useLibraryStore.getState().history).toHaveLength(HISTORY_LIMIT);
  });
});

describe("continue listening", () => {
  const send = mock<(data: string) => void>(() => undefined);

  beforeEach(() => {
    send.mockClear();
    useGlobalStore.setState({
      socket: { readyState: WebSocket.OPEN, send } as unknown as WebSocket,
      audioSources: [],
      selectedAudioUrl: "",
    });
  });

  afterEach(() => {
    mock.restore();
    useGlobalStore.setState({ changeAudioSource, broadcastPlay, getCurrentTrackPosition });
  });

  it("restores at most 20 songs, always including the one you were on", () => {
    const tracks = Array.from({ length: 30 }, (_, n) => track(n));
    const session = (currentId: LibraryTrack["id"]): LastSession => ({
      tracks,
      currentId,
      positionSeconds: 0,
      savedAt: 0,
    });
    expect(tracksToRestore(session(tracks[0].id)).map((t) => t.id)).toEqual(tracks.slice(0, 20).map((t) => t.id));
    expect(tracksToRestore(session(tracks[25].id)).map((t) => t.id)).toEqual(tracks.slice(10, 30).map((t) => t.id));
  });

  it("snapshots the YouTube songs in the queue, the current one and its position", () => {
    const [a, b] = [track(1), track(2)];
    useGlobalStore.setState({
      audioSources: [
        streamUrl(a),
        { source: { url: "https://cdn.example.com/room-1/upload___1.mp3" }, status: "idle" },
        streamUrl(b),
      ],
      selectedAudioUrl: streamUrl(b).source.url,
    });
    spyOn(useGlobalStore.getState(), "getCurrentTrackPosition").mockReturnValue(83);

    expect(snapshotSession()).toMatchObject({
      tracks: [
        { id: a.id, title: a.title },
        { id: b.id, title: b.title },
      ],
      currentId: b.id,
      positionSeconds: 83,
    });
  });

  it("re-adds the songs and resumes the current one at the saved position once it's ready", () => {
    const [a, b] = [track(1), track(2)];
    const state = useGlobalStore.getState();
    const select = spyOn(state, "changeAudioSource").mockReturnValue(false);
    const play = spyOn(state, "broadcastPlay").mockImplementation(() => undefined);

    resumeSession({ tracks: [a, b], currentId: b.id, positionSeconds: 95, savedAt: 0 });
    expect(send.mock.calls.map(([data]) => JSON.parse(data).trackId)).toEqual([a.id, b.id]);

    // The server adds placeholders first; a half-filled queue must not overwrite the saved session.
    useGlobalStore.setState({ audioSources: [streamUrl(a, true), streamUrl(b, true)] });
    expect(snapshotSession()).toBeNull();
    expect(play).not.toHaveBeenCalled();

    // b is ready: select it and play from 1:35.
    useGlobalStore.setState({ audioSources: [streamUrl(a, true), streamUrl(b)] });
    expect(select).toHaveBeenCalledWith(streamUrl(b).source.url);
    expect(play).toHaveBeenCalledWith(95);
    expect(snapshotSession()).not.toBeNull();
  });
});
