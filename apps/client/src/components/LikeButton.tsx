"use client";

import type { LibraryTrack } from "@/lib/libraryTrack";
import { cn } from "@/lib/utils";
import { useIsLiked, useLibraryStore } from "@/store/library";
import { Heart } from "lucide-react";

/** Heart toggle that saves a song to (or removes it from) the on-device Liked songs. */
export const LikeButton = ({ track, className }: { track: LibraryTrack; className?: string }) => {
  const isLiked = useIsLiked(track.id);
  const toggleLike = useLibraryStore((state) => state.toggleLike);

  return (
    <button
      type="button"
      aria-label={isLiked ? "Remove from Liked songs" : "Add to Liked songs"}
      aria-pressed={isLiked}
      onClick={(e) => {
        e.stopPropagation(); // rows add/play on click
        toggleLike(track);
      }}
      onPointerDown={(e) => e.stopPropagation()} // don't start a queue drag
      className={cn(
        "p-1 rounded-full transition-colors cursor-pointer focus:outline-none",
        isLiked ? "text-green-500 hover:text-green-400" : "text-neutral-500 hover:text-white",
        className
      )}
    >
      <Heart className={cn("size-4", isLiked && "fill-current")} />
    </button>
  );
};
