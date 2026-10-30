"use client";

import { fetchBrowsePlaylist, fetchMoodPlaylists, fetchMoods } from "@/lib/api";
import { trackFromSearchResult } from "@/lib/libraryTrack";
import { cn } from "@/lib/utils";
import { useGlobalStore } from "@/store/global";
import { useLibraryStore } from "@/store/library";
import type { BrowsePlaylistCardType, MoodCategoryType } from "@beatsync/shared";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ListPlus, Loader2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { addTracksToQueue, LibraryRow, SmallButton } from "./LibraryPanel";

// The server caches browse pages for hours; no need to refetch while browsing.
const BROWSE_STALE_MS = 60 * 60 * 1000;
// Fewer cards per shelf means fewer thumbnails requested at once (see Thumb).
const SHELF_LIMIT = 12;
const THUMB_RETRIES = 3;

type View =
  | { kind: "moods" }
  | { kind: "mood"; category: MoodCategoryType }
  | { kind: "playlist"; category?: MoodCategoryType; playlist: BrowsePlaylistCardType };

const Thumb = ({ src, className }: { src?: string; className: string }) => {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  if (!src || attempt > THUMB_RETRIES) return <div className={cn(className, "bg-neutral-800")} />;
  return (
    <div className={cn(className, "bg-neutral-800 overflow-hidden")}>
      {/* eslint-disable-next-line @next/next/no-img-element -- external thumbnails, same as SearchResults */}
      <img
        // A new key remounts the img, which makes the browser request it again.
        key={attempt}
        src={src}
        alt=""
        loading="lazy"
        className={cn("w-full h-full object-cover", failed && "invisible")}
        onLoad={() => setFailed(false)}
        onError={() => {
          // The image host answers bursts of thumbnail requests with 429; back off and retry.
          setFailed(true);
          setTimeout(() => setAttempt((n) => n + 1), 1000 * 2 ** attempt + Math.random() * 1000);
        }}
      />
    </div>
  );
};

const BackButton = ({ onClick, children }: { onClick: () => void; children: ReactNode }) => (
  <button
    type="button"
    onClick={onClick}
    className="flex items-center gap-0.5 -ml-1 mb-2 text-xs text-neutral-400 hover:text-white cursor-pointer"
  >
    <ChevronLeft className="size-3.5" />
    {children}
  </button>
);

/** Loading and error states shared by every browse page. */
const QueryState = ({ isError, refetch }: { isError: boolean; refetch: () => void }) =>
  isError ? (
    <div className="text-xs text-neutral-500 space-y-2">
      <p>Couldn&apos;t load this from YouTube Music.</p>
      <SmallButton onClick={refetch}>try again</SmallButton>
    </div>
  ) : (
    <div className="flex items-center gap-2 text-xs text-neutral-500">
      <Loader2 className="size-3.5 animate-spin" /> Loading…
    </div>
  );

const MoodsView = ({ onOpen }: { onOpen: (category: MoodCategoryType) => void }) => {
  const { data, isError, refetch } = useQuery({
    queryKey: ["browse", "moods"],
    queryFn: fetchMoods,
    staleTime: BROWSE_STALE_MS,
  });
  if (!data) return <QueryState isError={isError} refetch={() => void refetch()} />;

  return (
    <div className="space-y-4">
      {data.sections.map((section) => (
        <section key={section.title}>
          <h3 className="text-xs font-medium uppercase tracking-wide text-neutral-500 mb-2">{section.title}</h3>
          <div className="flex flex-wrap gap-1.5">
            {section.categories.map((category) => (
              <button
                key={category.params}
                type="button"
                onClick={() => onOpen(category)}
                className="px-2.5 py-1 rounded-full bg-neutral-800 hover:bg-neutral-700 text-xs text-neutral-200 cursor-pointer"
              >
                {category.title}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
};

const MoodView = ({
  category,
  onOpen,
}: {
  category: MoodCategoryType;
  onOpen: (playlist: BrowsePlaylistCardType) => void;
}) => {
  const { data, isError, refetch } = useQuery({
    queryKey: ["browse", "mood", category.params],
    queryFn: () => fetchMoodPlaylists(category.params),
    staleTime: BROWSE_STALE_MS,
  });

  return (
    <div className="space-y-4">
      <h2 className="text-base font-medium text-white">{category.title}</h2>
      {!data ? (
        <QueryState isError={isError} refetch={() => void refetch()} />
      ) : (
        data.sections.map((section) => (
          <section key={section.title}>
            <h3 className="text-xs font-medium text-neutral-400 mb-2">{section.title}</h3>
            <div className="flex gap-2 overflow-x-auto pb-1.5 -mx-1 px-1 [scrollbar-width:thin] [scrollbar-color:#404040_transparent]">
              {section.playlists.slice(0, SHELF_LIMIT).map((playlist) => (
                <button
                  key={playlist.id}
                  type="button"
                  onClick={() => onOpen(playlist)}
                  className="w-24 flex-shrink-0 text-left cursor-pointer group"
                >
                  <Thumb src={playlist.image} className="w-24 h-24 rounded group-hover:opacity-80" />
                  <p className="mt-1 text-xs text-white line-clamp-2">{playlist.title}</p>
                </button>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
};

const PlaylistView = ({ playlist }: { playlist: BrowsePlaylistCardType }) => {
  const createPlaylist = useLibraryStore((state) => state.createPlaylist);
  useGlobalStore((state) => state.audioSources); // re-render the "in queue" marks when the queue changes
  const { data, isError, refetch } = useQuery({
    queryKey: ["browse", "playlist", playlist.id],
    queryFn: () => fetchBrowsePlaylist(playlist.id),
    staleTime: BROWSE_STALE_MS,
  });
  const tracks = data?.tracks.map(trackFromSearchResult) ?? [];

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <Thumb src={playlist.image} className="w-16 h-16 rounded flex-shrink-0" />
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-white line-clamp-2">{data?.name ?? playlist.title}</h2>
          <p className="text-xs text-neutral-500 truncate">{data ? `${tracks.length} songs` : playlist.subtitle}</p>
        </div>
      </div>
      {!data ? (
        <QueryState isError={isError} refetch={() => void refetch()} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5 mb-2">
            <SmallButton onClick={() => addTracksToQueue(tracks)}>add all</SmallButton>
            <SmallButton onClick={() => addTracksToQueue(tracks, { shuffle: true })}>shuffle</SmallButton>
            <SmallButton
              label="Save to your playlists"
              onClick={() => {
                createPlaylist(data.name, tracks);
                toast.success(`Saved "${data.name}" to your playlists`);
              }}
            >
              <ListPlus className="size-3" /> save
            </SmallButton>
          </div>
          <div className="space-y-0.5">
            {tracks.map((track) => (
              <LibraryRow key={track.id} track={track} />
            ))}
          </div>
        </>
      )}
    </div>
  );
};

/** Browse YouTube Music: moods & genres, their curated playlists, and the songs in them. */
export const BrowsePanel = () => {
  const [view, setView] = useState<View>({ kind: "moods" });
  const topRef = useRef<HTMLDivElement>(null);

  // Each page starts at its top, not where the previous one was scrolled to.
  useEffect(() => {
    topRef.current?.scrollIntoView({ block: "nearest" });
  }, [view]);

  return (
    <div ref={topRef} className="px-3.5 py-3">
      {view.kind === "moods" && <MoodsView onOpen={(category) => setView({ kind: "mood", category })} />}
      {view.kind === "mood" && (
        <>
          <BackButton onClick={() => setView({ kind: "moods" })}>Moods &amp; genres</BackButton>
          <MoodView
            category={view.category}
            onOpen={(playlist) => setView({ kind: "playlist", category: view.category, playlist })}
          />
        </>
      )}
      {view.kind === "playlist" && (
        <>
          <BackButton
            onClick={() => setView(view.category ? { kind: "mood", category: view.category } : { kind: "moods" })}
          >
            {view.category?.title ?? "Moods & genres"}
          </BackButton>
          <PlaylistView playlist={view.playlist} />
        </>
      )}
    </div>
  );
};
