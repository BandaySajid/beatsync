"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { LibraryTrack } from "@/lib/libraryTrack";
import { useLibraryStore } from "@/store/library";
import { ListPlus, Plus } from "lucide-react";
import { toast } from "sonner";

/** Menu that saves a song to one of the on-device playlists, or to a new one. */
export const AddToPlaylistButton = ({ track }: { track: LibraryTrack }) => {
  const playlists = useLibraryStore((state) => state.playlists);
  const createPlaylist = useLibraryStore((state) => state.createPlaylist);
  const addToPlaylist = useLibraryStore((state) => state.addToPlaylist);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Add to playlist"
          onClick={(e) => e.stopPropagation()} // rows add/play on click
          onPointerDown={(e) => e.stopPropagation()} // don't start a queue drag
          className="p-1 rounded-full text-neutral-500 hover:text-white transition-colors cursor-pointer focus:outline-none"
        >
          <ListPlus className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuLabel className="text-xs text-neutral-500">Add to playlist</DropdownMenuLabel>
        <DropdownMenuItem
          onSelect={() => {
            const name = `My playlist #${playlists.length + 1}`;
            createPlaylist(name, track);
            toast.success(`Added to new playlist "${name}"`);
          }}
        >
          <Plus className="size-4" /> New playlist
        </DropdownMenuItem>
        {playlists.length > 0 && <DropdownMenuSeparator />}
        {playlists.map((playlist) => {
          const alreadyIn = playlist.tracks.some((existing) => existing.id === track.id);
          return (
            <DropdownMenuItem
              key={playlist.id}
              disabled={alreadyIn}
              onSelect={() => {
                addToPlaylist(playlist.id, track);
                toast.success(`Added to "${playlist.name}"`);
              }}
            >
              <span className="truncate">{playlist.name}</span>
              {alreadyIn && <span className="ml-auto text-xs text-neutral-500">added</span>}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
