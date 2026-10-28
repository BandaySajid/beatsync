"use client";
import { audioContextManager, isAudioContextPaused } from "@/lib/audioContextManager";
import { useGlobalStore } from "@/store/global";
import { sendWSRequest } from "@/utils/ws";
import { ClientActionEnum } from "@beatsync/shared";
import { Headphones } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

/**
 * Browser autoplay policy suspends the AudioContext after a reload. When the
 * tab had already completed Start System, show one full-screen tap target that
 * resumes audio and re-syncs with the room instead of dropping back to the
 * multi-second calibration/Start screen.
 */
export const ResumeAudioOverlay = () => {
  const hasUserStartedSystem = useGlobalStore((state) => state.hasUserStartedSystem);
  const [needsResume, setNeedsResume] = useState(false);
  const [isResuming, setIsResuming] = useState(false);

  useEffect(() => {
    if (!hasUserStartedSystem) {
      setNeedsResume(false);
      return;
    }

    const context = audioContextManager.getContext();
    const update = () => setNeedsResume(isAudioContextPaused(context.state));
    update();
    context.addEventListener("statechange", update);
    return () => context.removeEventListener("statechange", update);
  }, [hasUserStartedSystem]);

  if (!hasUserStartedSystem || !needsResume) return null;

  const handleResume = async () => {
    if (isResuming) return;
    setIsResuming(true);

    try {
      await audioContextManager.resume();
      setNeedsResume(false);

      const socket = useGlobalStore.getState().socket;
      if (socket && socket.readyState === WebSocket.OPEN) {
        sendWSRequest({ ws: socket, request: { type: ClientActionEnum.enum.SYNC } });
      }
    } catch {
      toast.error("Could not resume audio. Tap again.", { id: "resume-audio" });
    } finally {
      setIsResuming(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleResume}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 backdrop-blur-sm px-6"
      aria-label="Resume audio"
    >
      <span className="flex flex-col items-center gap-3 rounded-xl border border-neutral-700 bg-neutral-900/95 px-6 py-5 text-center shadow-2xl">
        <span className="flex size-11 items-center justify-center rounded-full bg-primary/15 text-primary">
          <Headphones className="size-5" />
        </span>
        <span className="text-sm font-medium text-white">
          {isResuming ? "Resuming audio..." : "Tap to resume audio"}
        </span>
        <span className="max-w-[15rem] text-xs text-neutral-400">
          Your browser paused sound after the refresh. One tap reconnects you to the room.
        </span>
      </span>
    </button>
  );
};
