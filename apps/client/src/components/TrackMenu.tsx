"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIsSoloLayout } from "@/hooks/useIsSoloLayout";
import type { LibraryTrack } from "@/lib/libraryTrack";
import { playNext } from "@/lib/queueActions";
import { useBrowseStore } from "@/store/browse";
import { useCanMutate } from "@/store/global";
import { useLibraryStore } from "@/store/library";
import { ListStart, MoreHorizontal, Plus, UserRound } from "lucide-react";
import { toast } from "sonner";

/** Per-song menu: play next, and save to one of the on-device playlists (or a new one). */
export const TrackMenu = ({ track }: { track: LibraryTrack }) => {
  const playlists = useLibraryStore((state) => state.playlists);
  const createPlaylist = useLibraryStore((state) => state.createPlaylist);
  const addToPlaylist = useLibraryStore((state) => state.addToPlaylist);
  // Moving a song in the queue needs the same permission as dragging it.
  const canMutate = useCanMutate();
  // Artist pages live in the solo panel's Browse tab, and only YouTube songs have one.
  const canBrowse = useIsSoloLayout() && typeof track.id === "string";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="More options"
          onClick={(e) => e.stopPropagation()} // rows add/play on click
          onPointerDown={(e) => e.stopPropagation()} // don't start a queue drag
          className="p-1 rounded-full text-neutral-500 hover:text-white transition-colors cursor-pointer focus:outline-none"
        >
          <MoreHorizontal className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        {canMutate && (
          <DropdownMenuItem onSelect={() => playNext(track)}>
            <ListStart className="size-4" /> Play next
          </DropdownMenuItem>
        )}
        {canBrowse && (
          <DropdownMenuItem onSelect={() => useBrowseStore.getState().openArtist(track.artist)}>
            <UserRound className="size-4" /> Go to artist
          </DropdownMenuItem>
        )}
        {(canMutate || canBrowse) && <DropdownMenuSeparator />}
        <DropdownMenuLabel className="text-xs text-neutral-500">Add to playlist</DropdownMenuLabel>
        <DropdownMenuItem
          onSelect={() => {
            const name = `My playlist #${playlists.length + 1}`;
            createPlaylist(name, [track]);
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
