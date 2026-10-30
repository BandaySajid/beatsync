"use client";

import { mixArtists, useDailyMixes } from "@/hooks/useDailyMixes";
import { fetchAlbum, fetchArtist, fetchBrowsePlaylist, fetchMoodPlaylists, fetchMoods, fetchRadio } from "@/lib/api";
import { trackFromSearchResult, type LibraryTrack } from "@/lib/libraryTrack";
import { cn } from "@/lib/utils";
import { browseViewTitle, useBrowseStore } from "@/store/browse";
import { useGlobalStore } from "@/store/global";
import { useLibraryStore } from "@/store/library";
import type { BrowseCardType, GetArtistResponseType, MoodCategoryType } from "@beatsync/shared";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ListMusic, ListPlus, Loader2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { addTracksToQueue, LibraryRow, SmallButton } from "./LibraryPanel";

// The server caches browse pages for hours; no need to refetch while browsing.
const BROWSE_STALE_MS = 60 * 60 * 1000;
// Fewer cards per shelf means fewer thumbnails requested at once (see Thumb).
const SHELF_LIMIT = 12;
const THUMB_RETRIES = 3;

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

/** A horizontally scrolling row of playlists, albums or artists. */
const Shelf = ({ title, cards }: { title: string; cards: BrowseCardType[] }) => {
  const open = useBrowseStore((state) => state.open);
  return (
    <section>
      <h3 className="text-xs font-medium text-neutral-400 mb-2">{title}</h3>
      <div className="flex gap-2 overflow-x-auto pb-1.5 -mx-1 px-1 [scrollbar-width:thin] [scrollbar-color:#404040_transparent]">
        {cards.slice(0, SHELF_LIMIT).map((card) => (
          <button
            key={`${card.kind}:${card.id}`}
            type="button"
            onClick={() => open({ kind: "card", card })}
            className="w-24 flex-shrink-0 text-left cursor-pointer group"
          >
            <Thumb
              src={card.image}
              className={cn("w-24 h-24 group-hover:opacity-80", card.kind === "artist" ? "rounded-full" : "rounded")}
            />
            <p className={cn("mt-1 text-xs text-white line-clamp-2", card.kind === "artist" && "text-center")}>
              {card.title}
            </p>
          </button>
        ))}
      </div>
    </section>
  );
};

const MoodsView = () => {
  const open = useBrowseStore((state) => state.open);
  const { data, isError, refetch } = useQuery({
    queryKey: ["browse", "moods"],
    queryFn: fetchMoods,
    staleTime: BROWSE_STALE_MS,
  });
  return (
    <div className="space-y-4">
      <MadeForYou />
      {!data && <QueryState isError={isError} refetch={() => void refetch()} />}
      {data?.sections.map((section) => (
        <section key={section.title}>
          <h3 className="text-xs font-medium uppercase tracking-wide text-neutral-500 mb-2">{section.title}</h3>
          <div className="flex flex-wrap gap-1.5">
            {section.categories.map((category) => (
              <button
                key={category.params}
                type="button"
                onClick={() => open({ kind: "mood", category })}
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

const MoodView = ({ category }: { category: MoodCategoryType }) => {
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
        data.sections.map((section) => <Shelf key={section.title} title={section.title} cards={section.cards} />)
      )}
    </div>
  );
};

/** A list of songs with add all / shuffle / save, under a cover and title. */
const TrackList = ({
  name,
  image,
  subtitle,
  tracks,
  isError,
  refetch,
}: {
  name: string;
  image?: string;
  subtitle: string;
  tracks: LibraryTrack[] | null; // null while loading
  isError: boolean;
  refetch: () => void;
}) => {
  const createPlaylist = useLibraryStore((state) => state.createPlaylist);
  useGlobalStore((state) => state.audioSources); // re-render the "in queue" marks when the queue changes

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <Thumb src={image} className="w-16 h-16 rounded flex-shrink-0" />
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-white line-clamp-2">{name}</h2>
          <p className="text-xs text-neutral-500 line-clamp-2">{tracks ? `${tracks.length} songs` : subtitle}</p>
        </div>
      </div>
      {!tracks ? (
        <QueryState isError={isError} refetch={refetch} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5 mb-2">
            <SmallButton onClick={() => addTracksToQueue(tracks)}>add all</SmallButton>
            <SmallButton onClick={() => addTracksToQueue(tracks, { shuffle: true })}>shuffle</SmallButton>
            <SmallButton
              label="Save to your playlists"
              onClick={() => {
                createPlaylist(name, tracks);
                toast.success(`Saved "${name}" to your playlists`);
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

/** The songs of a playlist or album. */
const TrackListView = ({ card }: { card: BrowseCardType }) => {
  const { data, isError, refetch } = useQuery({
    queryKey: ["browse", card.kind, card.id],
    queryFn: () => (card.kind === "album" ? fetchAlbum(card.id) : fetchBrowsePlaylist(card.id)),
    staleTime: BROWSE_STALE_MS,
  });
  return (
    <TrackList
      // Some pages (e.g. an artist's "all songs") have a generic name; keep the one we opened.
      name={card.title || data?.name || "Playlist"}
      image={card.image}
      subtitle={card.subtitle}
      tracks={data?.tracks.map(trackFromSearchResult) ?? null}
      isError={isError}
      refetch={() => void refetch()}
    />
  );
};

/** A song and the songs YouTube Music would play after it. */
const RadioView = ({ track }: { track: LibraryTrack & { id: string } }) => {
  const { data, isError, refetch } = useQuery({
    queryKey: ["browse", "radio", track.id],
    queryFn: () => fetchRadio(track.id),
    staleTime: BROWSE_STALE_MS,
  });
  return (
    <TrackList
      name={`${track.title} radio`}
      image={track.image}
      subtitle={`Songs like ${track.title} by ${track.artist}`}
      tracks={data ? [track, ...data.tracks.map(trackFromSearchResult)] : null}
      isError={isError}
      refetch={() => void refetch()}
    />
  );
};

const MixView = ({ index }: { index: number }) => {
  const mix = useDailyMixes()[index];
  if (!mix) return <QueryState isError={false} refetch={() => undefined} />;
  return (
    <TrackList
      name={mix.title}
      image={mix.seed.seed.image}
      subtitle={mixArtists(mix)}
      tracks={mix.tracks}
      isError={mix.isError}
      refetch={mix.refetch}
    />
  );
};

/** Today's daily mixes, from the artists you like and play most. */
const MadeForYou = () => {
  const open = useBrowseStore((state) => state.open);
  const mixes = useDailyMixes();
  if (mixes.length === 0) return null;

  return (
    <section>
      <h3 className="text-xs font-medium uppercase tracking-wide text-neutral-500 mb-2">Made for you</h3>
      <div className="flex gap-2 overflow-x-auto pb-1.5 -mx-1 px-1 [scrollbar-width:thin] [scrollbar-color:#404040_transparent]">
        {mixes.map((mix, index) => (
          <button
            key={mix.title}
            type="button"
            onClick={() => open({ kind: "mix", index, title: mix.title })}
            className="w-24 flex-shrink-0 text-left cursor-pointer group"
          >
            <div className="relative">
              <Thumb src={mix.seed.seed.image} className="w-24 h-24 rounded group-hover:opacity-80" />
              <span className="absolute bottom-1 left-1 right-1 text-[10px] font-semibold text-white bg-black/60 rounded px-1 truncate">
                {mix.title}
              </span>
            </div>
            <p className="mt-1 text-xs text-neutral-300 line-clamp-2">{mixArtists(mix)}</p>
          </button>
        ))}
      </div>
    </section>
  );
};

const ArtistView = ({ artist }: { artist: { id: string } | { name: string } }) => {
  const open = useBrowseStore((state) => state.open);
  useGlobalStore((state) => state.audioSources); // re-render the "in queue" marks when the queue changes
  const { data, isError, error, refetch } = useQuery<GetArtistResponseType>({
    queryKey: ["browse", "artist", "id" in artist ? artist.id : `name:${artist.name.toLowerCase()}`],
    queryFn: () => fetchArtist(artist),
    staleTime: BROWSE_STALE_MS,
  });

  if (!data) {
    if (isError && error.message === "Artist not found")
      return <p className="text-xs text-neutral-500">YouTube Music doesn&apos;t have an artist page for this name.</p>;
    return <QueryState isError={isError} refetch={() => void refetch()} />;
  }
  const songs = data.songs.map(trackFromSearchResult);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Thumb src={data.image} className="w-16 h-16 rounded-full flex-shrink-0" />
        <h2 className="text-base font-medium text-white line-clamp-2">{data.name}</h2>
      </div>
      {data.description && <p className="text-xs text-neutral-400 line-clamp-3">{data.description}</p>}

      {songs.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-xs font-medium text-neutral-400">Top songs</h3>
            <div className="flex items-center gap-1">
              <SmallButton onClick={() => addTracksToQueue(songs)}>add all</SmallButton>
              {data.allSongsPlaylistId && (
                <SmallButton
                  label={`All songs by ${data.name}`}
                  onClick={() =>
                    open({
                      kind: "card",
                      card: {
                        kind: "playlist",
                        id: data.allSongsPlaylistId!,
                        title: `All songs by ${data.name}`,
                        subtitle: "",
                        image: data.image,
                      },
                    })
                  }
                >
                  <ListMusic className="size-3" /> all songs
                </SmallButton>
              )}
            </div>
          </div>
          <div className="space-y-0.5">
            {songs.map((track) => (
              <LibraryRow key={track.id} track={track} />
            ))}
          </div>
        </section>
      )}

      {data.shelves.map((shelf) => (
        <Shelf key={shelf.title} title={shelf.title} cards={shelf.cards} />
      ))}
    </div>
  );
};

const BackButton = ({ children }: { children: ReactNode }) => (
  <button
    type="button"
    onClick={() => useBrowseStore.getState().back()}
    className="flex items-center gap-0.5 -ml-1 mb-2 text-xs text-neutral-400 hover:text-white cursor-pointer"
  >
    <ChevronLeft className="size-3.5" />
    <span className="truncate">{children}</span>
  </button>
);

/** Browse YouTube Music: moods & genres, curated playlists, albums and artist pages. */
export const BrowsePanel = () => {
  const stack = useBrowseStore((state) => state.stack);
  const view = stack[stack.length - 1];
  const previous = stack.length > 1 ? stack[stack.length - 2] : null;
  const topRef = useRef<HTMLDivElement>(null);

  // Each page starts at its top, not where the previous one was scrolled to.
  useEffect(() => {
    topRef.current?.scrollIntoView({ block: "nearest" });
  }, [view]);

  return (
    <div ref={topRef} className="px-3.5 py-3">
      {previous && <BackButton>{browseViewTitle(previous)}</BackButton>}
      {view.kind === "moods" && <MoodsView />}
      {view.kind === "mood" && <MoodView category={view.category} />}
      {view.kind === "artistByName" && <ArtistView artist={{ name: view.name }} />}
      {view.kind === "mix" && <MixView index={view.index} />}
      {view.kind === "radio" && <RadioView track={view.track} />}
      {view.kind === "card" &&
        (view.card.kind === "artist" ? (
          <ArtistView artist={{ id: view.card.id }} />
        ) : (
          <TrackListView key={view.card.id} card={view.card} />
        ))}
    </div>
  );
};
