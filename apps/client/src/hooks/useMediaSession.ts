import { splitTrackName, youtubeIdFromUrl, youtubeThumbnail } from "@/lib/libraryTrack";
import { extractFileNameFromUrl } from "@/lib/utils";
import { useCanMutate, useGlobalStore } from "@/store/global";
import { useEffect } from "react";

const SEEK_STEP_SECONDS = 10;

/**
 * Lock screen, notification and headphone-button controls (Media Session API).
 * Buttons call the same store actions as the on-screen player, with the same permissions.
 */
export const useMediaSession = () => {
  const selectedAudioUrl = useGlobalStore((state) => state.selectedAudioUrl);
  const isPlaying = useGlobalStore((state) => state.isPlaying);
  const duration = useGlobalStore((state) => state.duration);
  const currentTime = useGlobalStore((state) => state.currentTime);
  const canMutate = useCanMutate();

  // Now playing: title, artist and (for YouTube) the video thumbnail as cover art.
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    if (!selectedAudioUrl) {
      navigator.mediaSession.metadata = null;
      return;
    }
    const { artist, title } = splitTrackName(extractFileNameFromUrl(selectedAudioUrl));
    const videoId = youtubeIdFromUrl(selectedAudioUrl);
    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist,
      album: "Beatsync",
      artwork: videoId ? [{ src: youtubeThumbnail(videoId), sizes: "480x360", type: "image/jpeg" }] : [],
    });
  }, [selectedAudioUrl]);

  // Play/pause state and the progress bar; the browser advances the position itself while playing.
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = selectedAudioUrl ? (isPlaying ? "playing" : "paused") : "none";
    if (duration <= 0) return;
    const position = Math.min(Math.max(useGlobalStore.getState().getCurrentTrackPosition(), 0), duration);
    try {
      navigator.mediaSession.setPositionState({ duration, position, playbackRate: 1 });
    } catch {
      // Rejected while a track switch is half applied; the next update fixes it.
    }
  }, [selectedAudioUrl, isPlaying, duration, currentTime]);

  // Buttons. Without playback permission they are removed, like the disabled on-screen controls.
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const store = () => useGlobalStore.getState();
    const seekTo = (seconds: number) => {
      const state = store();
      const position = Math.min(Math.max(seconds, 0), state.duration || seconds);
      if (state.isPlaying) state.broadcastPlay(position);
      else useGlobalStore.setState({ currentTime: position });
    };

    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ["play", () => store().broadcastPlay()],
      ["pause", () => store().broadcastPause()],
      ["nexttrack", () => store().skipToNextTrack()],
      // Same as the on-screen button: "previous" is unavailable while shuffling.
      ["previoustrack", () => !store().isShuffled && store().skipToPreviousTrack()],
      ["seekto", (details) => details.seekTime !== undefined && seekTo(details.seekTime)],
      [
        "seekbackward",
        (details) => seekTo(store().getCurrentTrackPosition() - (details.seekOffset ?? SEEK_STEP_SECONDS)),
      ],
      [
        "seekforward",
        (details) => seekTo(store().getCurrentTrackPosition() + (details.seekOffset ?? SEEK_STEP_SECONDS)),
      ],
    ];

    const setHandlers = (enabled: boolean) => {
      for (const [action, handler] of handlers) {
        try {
          navigator.mediaSession.setActionHandler(action, enabled ? handler : null);
        } catch {
          // This browser doesn't support that action.
        }
      }
    };
    setHandlers(canMutate);
    return () => setHandlers(false);
  }, [canMutate]);
};
