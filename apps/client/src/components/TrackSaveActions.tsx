"use client";

import { AddToPlaylistButton } from "@/components/AddToPlaylistButton";
import { LikeButton } from "@/components/LikeButton";
import type { LibraryTrack } from "@/lib/libraryTrack";

/** Heart + add-to-playlist, shown wherever a saveable song appears. */
export const TrackSaveActions = ({ track }: { track: LibraryTrack }) => (
  <div className="flex items-center">
    <AddToPlaylistButton track={track} />
    <LikeButton track={track} />
  </div>
);
