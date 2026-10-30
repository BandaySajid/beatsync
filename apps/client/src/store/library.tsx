"use client";
import type { LibraryTrack } from "@/lib/libraryTrack";
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface LibraryState {
  liked: LibraryTrack[]; // newest first
  toggleLike: (track: LibraryTrack) => void;
}

/** The on-device music library, saved in this browser's localStorage (no account). */
export const useLibraryStore = create<LibraryState>()(
  persist(
    (set) => ({
      liked: [],
      toggleLike: (track) =>
        set((state) => ({
          liked: state.liked.some((liked) => liked.id === track.id)
            ? state.liked.filter((liked) => liked.id !== track.id)
            : [track, ...state.liked],
        })),
    }),
    { name: "beatsync:library-v1" }
  )
);

export const useIsLiked = (id: LibraryTrack["id"]) =>
  useLibraryStore((state) => state.liked.some((track) => track.id === id));
