"use client";

import { cn } from "@/lib/utils";
import { useGlobalStore } from "@/store/global";
import { sendWSRequest } from "@/utils/ws";
import { ClientActionEnum, type TrackType } from "@beatsync/shared";
import { Plus } from "lucide-react";
import { toast } from "sonner";

export const SimilarSongs = ({ className }: { className?: string }) => {
  const suggestions = useGlobalStore((state) => state.suggestions);
  const socket = useGlobalStore((state) => state.socket);

  if (suggestions.length === 0) return null;

  const addTrack = (track: TrackType) => {
    if (!socket) {
      toast.error("Not connected to server");
      return;
    }
    sendWSRequest({
      ws: socket,
      request: {
        type: ClientActionEnum.enum.STREAM_MUSIC,
        trackId: track.id,
        trackName: `${track.performer.name} - ${track.title}`,
      },
    });
  };

  return (
    <div className={cn("", className)}>
      <h3 className="text-xs font-medium uppercase tracking-wide text-neutral-500 px-3 mb-2">Similar songs</h3>
      <div className="space-y-1">
        {suggestions.map((track) => (
          <button
            key={track.id}
            type="button"
            onClick={() => addTrack(track)}
            className="group w-full text-left hover:bg-neutral-800 px-3 py-2 transition-colors flex items-center gap-3 rounded-md cursor-pointer"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- external YouTube thumbnails, same as SearchResults */}
            <img
              src={track.album.image.thumbnail}
              alt=""
              className="w-10 h-10 rounded object-cover bg-neutral-800 flex-shrink-0"
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-white truncate">{track.title}</p>
              <p className="text-xs text-neutral-400 truncate">{track.performer.name}</p>
            </div>
            <Plus className="h-3 w-3 text-neutral-500 group-hover:text-white" aria-label="Add to queue" />
          </button>
        ))}
      </div>
    </div>
  );
};
