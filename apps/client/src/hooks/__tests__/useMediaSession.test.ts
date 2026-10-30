import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { renderHook } from "@testing-library/react";
import { useMediaSession } from "@/hooks/useMediaSession";
import { useGlobalStore } from "@/store/global";
import type { ClientDataType } from "@beatsync/shared";

// happy-dom has no Media Session; record what the hook sets.
const handlers = new Map<string, MediaSessionActionHandler | null>();
const session = {
  metadata: null as { title: string; artist: string; artwork: { src: string }[] } | null,
  playbackState: "none",
  position: null as MediaPositionState | null,
  setActionHandler: (action: string, handler: MediaSessionActionHandler | null) => handlers.set(action, handler),
  setPositionState: (state: MediaPositionState) => {
    session.position = state;
  },
};
Object.defineProperty(navigator, "mediaSession", { value: session, configurable: true });
(globalThis as { MediaMetadata?: unknown }).MediaMetadata = class {
  constructor(init: object) {
    Object.assign(this, init);
  }
};

// Spied store actions get copied into every later state object, so put the real ones back.
const { broadcastPlay, broadcastPause, skipToNextTrack, getCurrentTrackPosition } = useGlobalStore.getState();

const URL_YT = "/stream/youtube/dQw4w9WgXcQ/Rick%20Astley%20-%20Never%20Gonna%20Give%20You%20Up___abc.m4a";
const press = (action: string, details: Partial<MediaSessionActionDetails> = {}) =>
  handlers.get(action)?.({ action, ...details } as MediaSessionActionDetails);

describe("useMediaSession", () => {
  beforeEach(() => {
    handlers.clear();
    useGlobalStore.setState({
      selectedAudioUrl: URL_YT,
      isPlaying: true,
      duration: 213,
      currentTime: 0,
      isShuffled: false,
      // Admin, so playback controls are allowed
      currentUser: { clientId: "me", isAdmin: true } as ClientDataType,
    });
  });

  afterEach(() => {
    handlers.clear();
    mock.restore();
    useGlobalStore.setState({ broadcastPlay, broadcastPause, skipToNextTrack, getCurrentTrackPosition });
  });

  it("shows title, artist, cover art and playback state on the lock screen", () => {
    spyOn(useGlobalStore.getState(), "getCurrentTrackPosition").mockReturnValue(42);
    renderHook(() => useMediaSession());

    expect(session.metadata).toMatchObject({ title: "Never Gonna Give You Up", artist: "Rick Astley" });
    expect(session.metadata?.artwork[0].src).toBe("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
    expect(session.playbackState).toBe("playing");
    expect(session.position).toEqual({ duration: 213, position: 42, playbackRate: 1 });
  });

  it("routes lock-screen buttons to the player's actions", () => {
    const state = useGlobalStore.getState();
    const pause = spyOn(state, "broadcastPause").mockImplementation(() => undefined);
    const play = spyOn(state, "broadcastPlay").mockImplementation(() => undefined);
    const next = spyOn(state, "skipToNextTrack").mockImplementation(() => undefined);
    renderHook(() => useMediaSession());

    press("pause");
    press("nexttrack");
    press("seekto", { seekTime: 90 });
    expect(pause).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalledWith(90); // seeking while playing restarts at the new position
  });

  it("removes the buttons for listeners without playback permission", () => {
    useGlobalStore.setState({
      currentUser: { clientId: "me", isAdmin: false } as ClientDataType,
      playbackControlsPermissions: "ADMIN_ONLY",
    });
    renderHook(() => useMediaSession());
    expect(handlers.get("play")).toBeNull();
    expect(handlers.get("nexttrack")).toBeNull();
  });
});
