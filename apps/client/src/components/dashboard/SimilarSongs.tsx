"use client";

import { cn } from "@/lib/utils";
import { useCanMutate, useGlobalStore } from "@/store/global";
import { sendWSRequest } from "@/utils/ws";
import { ClientActionEnum, type TrackType } from "@beatsync/shared";
import { Plus } from "lucide-react";
import { toast } from "sonner";

export const SimilarSongs = ({ className }: { className?: string }) => {
  const suggestions = useGlobalStore((state) => state.suggestions);
  const autoQueue = useGlobalStore((state) => state.autoQueue);
  const socket = useGlobalStore((state) => state.socket);
  const canMutate = useCanMutate();

  if (suggestions.length === 0) return null;

  const toggleAutoQueue = () => {
    if (!socket) return;
    sendWSRequest({ ws: socket, request: { type: ClientActionEnum.enum.SET_AUTO_QUEUE, enabled: !autoQueue } });
  };

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
      <div className="flex items-center justify-between px-3 mb-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-neutral-500">Similar songs</h3>
        <button
          type="button"
          onClick={toggleAutoQueue}
          disabled={!canMutate}
          aria-pressed={autoQueue}
          title={canMutate ? "Add a similar song when the queue runs out" : "Only admins can change this in this room"}
          className={cn(
            "text-[10px] font-mono px-2 py-0.5 rounded transition-colors",
            autoQueue ? "bg-white text-black" : "text-neutral-500 bg-neutral-800",
            canMutate ? "cursor-pointer hover:opacity-80" : "cursor-not-allowed opacity-50"
          )}
        >
          auto-play {autoQueue ? "on" : "off"}
        </button>
      </div>
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
