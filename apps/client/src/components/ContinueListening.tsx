"use client";

import { useLibraryStore } from "@/store/library";
import { formatTime } from "@/lib/utils";
import { PlayCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useSyncExternalStore } from "react";

const subscribeNever = () => () => {};

/** Home-page card that reopens your last solo session where you left off. */
export const ContinueListening = ({ disabled }: { disabled?: boolean }) => {
  const router = useRouter();
  const lastSession = useLibraryStore((state) => state.lastSession);
  // The saved session only exists in this browser: render nothing on the server and while
  // hydrating, so the first client render matches the server HTML.
  const mounted = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false
  );

  if (!mounted || !lastSession) return null;
  const current = lastSession.tracks.find((track) => track.id === lastSession.currentId) ?? lastSession.tracks[0];
  const others = lastSession.tracks.length - 1;

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        const roomId = Math.floor(100000 + Math.random() * 900000).toString();
        router.push(`/room/${roomId}?solo=1&resume=1`);
      }}
      className="w-full flex items-center gap-3 p-2.5 rounded-lg bg-neutral-800/60 hover:bg-neutral-800 border border-neutral-700/50 text-left cursor-pointer transition-colors"
    >
      {current.image ? (
        // eslint-disable-next-line @next/next/no-img-element -- external thumbnails, same as SearchResults
        <img src={current.image} alt="" className="w-10 h-10 rounded object-cover bg-neutral-800 flex-shrink-0" />
      ) : (
        <div className="w-10 h-10 rounded bg-neutral-800 flex-shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-[10px] uppercase tracking-wide text-neutral-500">Continue listening</p>
        <p className="text-sm text-white truncate">{current.title}</p>
        <p className="text-xs text-neutral-400 truncate">
          {current.artist}
          {lastSession.positionSeconds > 0 && ` · at ${formatTime(lastSession.positionSeconds)}`}
          {others > 0 && ` · +${others} more`}
        </p>
      </div>
      <PlayCircle className="size-6 text-white flex-shrink-0" />
    </button>
  );
};
