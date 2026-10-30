import { trackFromQueueUrl } from "@/lib/libraryTrack";
import { resumeSession, saveSessionSnapshot } from "@/lib/session";
import { useGlobalStore } from "@/store/global";
import { useLibraryStore } from "@/store/library";
import { useRoomStore } from "@/store/room";
import { useEffect, useRef } from "react";

const SNAPSHOT_INTERVAL_MS = 5000;

/**
 * Records recently played songs, keeps a snapshot of the solo session for "Continue
 * listening", and performs a resume when the room was opened with ?resume=1.
 */
export const useListeningHistory = () => {
  const selectedAudioUrl = useGlobalStore((state) => state.selectedAudioUrl);
  const isPlaying = useGlobalStore((state) => state.isPlaying);
  const hasJoined = useGlobalStore((state) => state.connectedClients.length > 0);
  const hasStarted = useGlobalStore((state) => state.hasUserStartedSystem);
  const isSolo = useRoomStore((state) => state.isSolo);
  const resumed = useRef(false);

  // Recently played: a song counts once it starts playing.
  useEffect(() => {
    if (!isPlaying) return;
    const track = trackFromQueueUrl(selectedAudioUrl);
    if (track) useLibraryStore.getState().recordPlayed(track);
  }, [isPlaying, selectedAudioUrl]);

  // Continue listening: snapshot the solo queue while you listen and when you leave.
  useEffect(() => {
    if (!isSolo) return;
    const interval = setInterval(saveSessionSnapshot, SNAPSHOT_INTERVAL_MS);
    const saveWhenHidden = () => {
      if (document.visibilityState === "hidden") saveSessionSnapshot();
    };
    window.addEventListener("pagehide", saveSessionSnapshot);
    document.addEventListener("visibilitychange", saveWhenHidden);
    return () => {
      clearInterval(interval);
      window.removeEventListener("pagehide", saveSessionSnapshot);
      document.removeEventListener("visibilitychange", saveWhenHidden);
      saveSessionSnapshot();
    };
  }, [isSolo]);

  // Resume once: after Start System (audio unlocked) and after joining the room.
  useEffect(() => {
    if (resumed.current || !hasStarted || !hasJoined) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("resume") !== "1") return;
    resumed.current = true;
    // A reload must not re-add everything again.
    url.searchParams.delete("resume");
    window.history.replaceState(null, "", url);
    const session = useLibraryStore.getState().lastSession;
    if (session) resumeSession(session);
  }, [hasStarted, hasJoined]);
};
