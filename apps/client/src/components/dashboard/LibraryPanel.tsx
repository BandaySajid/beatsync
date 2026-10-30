"use client";

import { LikeButton } from "@/components/LikeButton";
import { isTrackQueued, queueLibraryTrack, type LibraryTrack } from "@/lib/libraryTrack";
import { useGlobalStore } from "@/store/global";
import { useLibraryStore } from "@/store/library";
import { Check, Heart, Plus } from "lucide-react";
import { toast } from "sonner";

// shortcut: each add makes the server resolve + download that song with no server-side
// concurrency limit, so batch adds are capped; raise this once the server queues them.
const ADD_ALL_LIMIT = 20;

const LibraryRow = ({ track, queued }: { track: LibraryTrack; queued: boolean }) => (
  <div className="flex items-center gap-1 pr-1 rounded-md hover:bg-neutral-800 transition-colors">
    <button
      type="button"
      onClick={() => {
        if (queued) toast.info("Already in the queue");
        else if (queueLibraryTrack(track)) toast.success(`Added "${track.title}"`);
      }}
      className="group flex-1 min-w-0 text-left px-2 py-1.5 flex items-center gap-3 cursor-pointer"
    >
      {track.image ? (
        // eslint-disable-next-line @next/next/no-img-element -- external thumbnails, same as SearchResults
        <img src={track.image} alt="" className="w-9 h-9 rounded object-cover bg-neutral-800 flex-shrink-0" />
      ) : (
        <div className="w-9 h-9 rounded bg-neutral-800 flex-shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-white truncate">{track.title}</p>
        <p className="text-xs text-neutral-400 truncate">{track.artist}</p>
      </div>
      {queued ? (
        <Check className="h-3 w-3 text-neutral-500" aria-label="In the queue" />
      ) : (
        <Plus className="h-3 w-3 text-neutral-500 group-hover:text-white" aria-label="Add to queue" />
      )}
    </button>
    <LikeButton track={track} />
  </div>
);

/** The on-device library: songs you saved with the heart. */
export const LibraryPanel = () => {
  const liked = useLibraryStore((state) => state.liked);
  useGlobalStore((state) => state.audioSources); // re-render the "in queue" marks when the queue changes

  const addAll = () => {
    const toAdd = liked.filter((track) => !isTrackQueued(track)).slice(0, ADD_ALL_LIMIT);
    if (toAdd.length === 0) {
      toast.info("All liked songs are already in the queue");
      return;
    }
    toAdd.forEach(queueLibraryTrack);
    toast.success(`Added ${toAdd.length} liked song${toAdd.length === 1 ? "" : "s"}`);
  };

  return (
    <div className="px-3.5 py-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-neutral-500 flex items-center gap-1.5">
          <Heart className="size-3 fill-current text-green-500" />
          Liked songs · {liked.length}
        </h3>
        {liked.length > 0 && (
          <button
            type="button"
            onClick={addAll}
            className="text-[10px] font-mono px-2 py-0.5 rounded text-neutral-300 bg-neutral-800 hover:bg-neutral-700 cursor-pointer"
          >
            add all
          </button>
        )}
      </div>
      {liked.length === 0 ? (
        <p className="text-xs text-neutral-500">
          Tap the heart on any YouTube song to save it here. Saved on this device only.
        </p>
      ) : (
        <div className="space-y-0.5">
          {liked.map((track) => (
            <LibraryRow key={track.id} track={track} queued={isTrackQueued(track)} />
          ))}
        </div>
      )}
    </div>
  );
};
