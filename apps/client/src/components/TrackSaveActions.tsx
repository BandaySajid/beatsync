"use client";

import { LikeButton } from "@/components/LikeButton";
import { TrackMenu } from "@/components/TrackMenu";
import type { LibraryTrack } from "@/lib/libraryTrack";

/** Per-song menu (play next, add to playlist) + heart, shown wherever a saveable song appears. */
export const TrackSaveActions = ({ track }: { track: LibraryTrack }) => (
  <div className="flex items-center">
    <TrackMenu track={track} />
    <LikeButton track={track} />
  </div>
);
