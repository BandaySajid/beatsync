"use client";
import type { LibraryTrack } from "@/lib/libraryTrack";
import { nanoid } from "nanoid";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface Playlist {
  id: string;
  name: string;
  tracks: LibraryTrack[];
}

interface LibraryState {
  liked: LibraryTrack[]; // newest first
  playlists: Playlist[]; // newest first
  toggleLike: (track: LibraryTrack) => void;
  /** Creates a playlist (optionally with a first song) and returns its id. */
  createPlaylist: (name: string, firstTrack?: LibraryTrack) => string;
  renamePlaylist: (id: string, name: string) => void;
  deletePlaylist: (id: string) => void;
  addToPlaylist: (id: string, track: LibraryTrack) => void;
  removeFromPlaylist: (id: string, trackId: LibraryTrack["id"]) => void;
  moveInPlaylist: (id: string, from: number, to: number) => void;
}

const updatePlaylist = (playlists: Playlist[], id: string, change: (playlist: Playlist) => Playlist) =>
  playlists.map((playlist) => (playlist.id === id ? change(playlist) : playlist));

/** The on-device music library, saved in this browser's localStorage (no account). */
export const useLibraryStore = create<LibraryState>()(
  persist(
    (set) => ({
      liked: [],
      playlists: [],
      toggleLike: (track) =>
        set((state) => ({
          liked: state.liked.some((liked) => liked.id === track.id)
            ? state.liked.filter((liked) => liked.id !== track.id)
            : [track, ...state.liked],
        })),
      createPlaylist: (name, firstTrack) => {
        const id = nanoid();
        set((state) => ({ playlists: [{ id, name, tracks: firstTrack ? [firstTrack] : [] }, ...state.playlists] }));
        return id;
      },
      renamePlaylist: (id, name) =>
        set((state) => ({ playlists: updatePlaylist(state.playlists, id, (playlist) => ({ ...playlist, name })) })),
      deletePlaylist: (id) => set((state) => ({ playlists: state.playlists.filter((playlist) => playlist.id !== id) })),
      addToPlaylist: (id, track) =>
        set((state) => ({
          playlists: updatePlaylist(state.playlists, id, (playlist) =>
            playlist.tracks.some((existing) => existing.id === track.id)
              ? playlist
              : { ...playlist, tracks: [...playlist.tracks, track] }
          ),
        })),
      removeFromPlaylist: (id, trackId) =>
        set((state) => ({
          playlists: updatePlaylist(state.playlists, id, (playlist) => ({
            ...playlist,
            tracks: playlist.tracks.filter((track) => track.id !== trackId),
          })),
        })),
      moveInPlaylist: (id, from, to) =>
        set((state) => ({
          playlists: updatePlaylist(state.playlists, id, (playlist) => {
            if (to < 0 || to >= playlist.tracks.length) return playlist;
            const tracks = [...playlist.tracks];
            const [moved] = tracks.splice(from, 1);
            tracks.splice(to, 0, moved);
            return { ...playlist, tracks };
          }),
        })),
    }),
    // Version 1 data (liked only) loads as-is; playlists start empty.
    { name: "beatsync:library-v1" }
  )
);

export const useIsLiked = (id: LibraryTrack["id"]) =>
  useLibraryStore((state) => state.liked.some((track) => track.id === id));
