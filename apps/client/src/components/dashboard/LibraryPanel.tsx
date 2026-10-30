"use client";

import { TrackSaveActions } from "@/components/TrackSaveActions";
import { isTrackQueued, queueLibraryTrack, type LibraryTrack } from "@/lib/libraryTrack";
import { cn } from "@/lib/utils";
import { useGlobalStore } from "@/store/global";
import { useLibraryStore, type Playlist } from "@/store/library";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  Heart,
  History,
  ListMusic,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

// shortcut: each add makes the server resolve + download that song with no server-side
// concurrency limit, so batch adds are capped; raise this once the server queues them.
const ADD_ALL_LIMIT = 20;
const RECENT_SHOWN = 8;

/** Add songs to the queue in order (or shuffled), skipping ones already queued. */
const addTracksToQueue = (tracks: LibraryTrack[], { shuffle = false } = {}) => {
  const candidates = tracks.filter((track) => !isTrackQueued(track));
  if (shuffle) {
    // Fisher-Yates: an unbiased shuffle
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
  }
  const toAdd = candidates.slice(0, ADD_ALL_LIMIT);
  if (toAdd.length === 0) {
    toast.info("All of these songs are already in the queue");
    return;
  }
  toAdd.forEach(queueLibraryTrack);
  toast.success(`Added ${toAdd.length} song${toAdd.length === 1 ? "" : "s"} to the queue`);
};

const SmallButton = ({ onClick, children, label }: { onClick: () => void; children: ReactNode; label?: string }) => (
  <button
    type="button"
    aria-label={label}
    onClick={onClick}
    className="text-[10px] font-mono px-2 py-0.5 rounded text-neutral-300 bg-neutral-800 hover:bg-neutral-700 cursor-pointer flex items-center gap-1"
  >
    {children}
  </button>
);

const LibraryRow = ({ track, actions }: { track: LibraryTrack; actions?: ReactNode }) => {
  const queued = isTrackQueued(track);
  return (
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
      {actions ?? <TrackSaveActions track={track} />}
    </div>
  );
};

const PlaylistDetail = ({ playlist }: { playlist: Playlist }) => {
  const { renamePlaylist, deletePlaylist, removeFromPlaylist, moveInPlaylist } = useLibraryStore.getState();
  const [editingName, setEditingName] = useState<string | null>(null);

  return (
    <div className="pl-2 pb-2">
      <div className="flex flex-wrap items-center gap-1.5 py-1.5">
        {editingName !== null ? (
          <form
            className="flex items-center gap-1 w-full"
            onSubmit={(e) => {
              e.preventDefault();
              if (editingName.trim()) renamePlaylist(playlist.id, editingName.trim());
              setEditingName(null);
            }}
          >
            <input
              autoFocus
              aria-label="Playlist name"
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              className="flex-1 min-w-0 bg-neutral-800 rounded px-2 py-1 text-sm text-white outline-none focus:ring-1 focus:ring-neutral-600"
            />
            <button
              type="submit"
              aria-label="Save name"
              className="text-[10px] px-2 py-1 rounded text-neutral-300 bg-neutral-800 hover:bg-neutral-700 cursor-pointer"
            >
              <Check className="size-3" />
            </button>
          </form>
        ) : (
          <>
            {playlist.tracks.length > 0 && (
              <>
                <SmallButton onClick={() => addTracksToQueue(playlist.tracks)}>add all</SmallButton>
                <SmallButton onClick={() => addTracksToQueue(playlist.tracks, { shuffle: true })}>shuffle</SmallButton>
              </>
            )}
            <SmallButton label="Rename playlist" onClick={() => setEditingName(playlist.name)}>
              <Pencil className="size-3" /> rename
            </SmallButton>
            <SmallButton
              label="Delete playlist"
              onClick={() => {
                if (window.confirm(`Delete "${playlist.name}"? This can't be undone.`)) deletePlaylist(playlist.id);
              }}
            >
              <Trash2 className="size-3" /> delete
            </SmallButton>
          </>
        )}
      </div>
      {playlist.tracks.length === 0 ? (
        <p className="text-xs text-neutral-500 py-1">Use the playlist button next to any song to add it here.</p>
      ) : (
        playlist.tracks.map((track, index) => (
          <LibraryRow
            key={track.id}
            track={track}
            actions={
              <div className="flex items-center text-neutral-500">
                <button
                  type="button"
                  aria-label="Move up"
                  disabled={index === 0}
                  onClick={() => moveInPlaylist(playlist.id, index, index - 1)}
                  className="p-1 hover:text-white disabled:opacity-30 cursor-pointer disabled:cursor-default"
                >
                  <ArrowUp className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="Move down"
                  disabled={index === playlist.tracks.length - 1}
                  onClick={() => moveInPlaylist(playlist.id, index, index + 1)}
                  className="p-1 hover:text-white disabled:opacity-30 cursor-pointer disabled:cursor-default"
                >
                  <ArrowDown className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="Remove from playlist"
                  onClick={() => removeFromPlaylist(playlist.id, track.id)}
                  className="p-1 hover:text-red-400 cursor-pointer"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            }
          />
        ))
      )}
    </div>
  );
};

const SectionHeader = ({ icon, title, action }: { icon: ReactNode; title: string; action?: ReactNode }) => (
  <div className="flex items-center justify-between mb-2">
    <h3 className="text-xs font-medium uppercase tracking-wide text-neutral-500 flex items-center gap-1.5">
      {icon}
      {title}
    </h3>
    {action}
  </div>
);

/** The on-device library: liked songs and playlists. */
export const LibraryPanel = () => {
  const liked = useLibraryStore((state) => state.liked);
  const playlists = useLibraryStore((state) => state.playlists);
  const history = useLibraryStore((state) => state.history);
  const createPlaylist = useLibraryStore((state) => state.createPlaylist);
  const [openPlaylistId, setOpenPlaylistId] = useState<string | null>(null);
  useGlobalStore((state) => state.audioSources); // re-render the "in queue" marks when the queue changes

  return (
    <div className="px-3.5 py-3 space-y-5">
      {history.length > 0 && (
        <section>
          <SectionHeader icon={<History className="size-3" />} title="Recently played" />
          <div className="space-y-0.5">
            {history.slice(0, RECENT_SHOWN).map((track) => (
              <LibraryRow key={track.id} track={track} />
            ))}
          </div>
        </section>
      )}

      <section>
        <SectionHeader
          icon={<Heart className="size-3 fill-current text-green-500" />}
          title={`Liked songs · ${liked.length}`}
          action={liked.length > 0 && <SmallButton onClick={() => addTracksToQueue(liked)}>add all</SmallButton>}
        />
        {liked.length === 0 ? (
          <p className="text-xs text-neutral-500">
            Tap the heart on any YouTube song to save it here. Saved on this device only.
          </p>
        ) : (
          <div className="space-y-0.5">
            {liked.map((track) => (
              <LibraryRow key={track.id} track={track} />
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionHeader
          icon={<ListMusic className="size-3" />}
          title={`Playlists · ${playlists.length}`}
          action={
            <SmallButton
              label="New playlist"
              onClick={() => setOpenPlaylistId(createPlaylist(`My playlist #${playlists.length + 1}`))}
            >
              <Plus className="size-3" /> new
            </SmallButton>
          }
        />
        {playlists.length === 0 ? (
          <p className="text-xs text-neutral-500">Create a playlist, or use the playlist button next to any song.</p>
        ) : (
          <div className="space-y-0.5">
            {playlists.map((playlist) => {
              const isOpen = openPlaylistId === playlist.id;
              return (
                <div key={playlist.id}>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpenPlaylistId(isOpen ? null : playlist.id)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-neutral-800 text-left cursor-pointer"
                  >
                    <ChevronRight
                      className={cn("size-3.5 text-neutral-500 transition-transform", isOpen && "rotate-90")}
                    />
                    <span className="flex-1 min-w-0 truncate text-sm text-white">{playlist.name}</span>
                    <span className="text-xs text-neutral-500">{playlist.tracks.length}</span>
                  </button>
                  {isOpen && <PlaylistDetail playlist={playlist} />}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
