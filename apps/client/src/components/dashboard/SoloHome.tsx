"use client";

import { mixArtists, useDailyMixes } from "@/hooks/useDailyMixes";
import { fetchMoods } from "@/lib/api";
import { rankArtists } from "@/lib/dailyMixes";
import { isTrackQueued, queueLibraryTrack, type LibraryTrack } from "@/lib/libraryTrack";
import { cn } from "@/lib/utils";
import { useBrowseStore, type BrowseView } from "@/store/browse";
import { useGlobalStore } from "@/store/global";
import { useLibraryStore } from "@/store/library";
import { useQuery } from "@tanstack/react-query";
import { Heart, ListMusic, Play, Sparkles } from "lucide-react";
import { useSyncExternalStore, type ReactNode } from "react";
import { toast } from "sonner";
import { addTracksToQueue } from "./LibraryPanel";

const TILE_PLAYLISTS = 5;
const RECENT_SHOWN = 12;
const TOP_ARTISTS_SHOWN = 8;
const MOODS_SHOWN = 16;

const subscribeNever = () => () => {};

const greeting = (hour = new Date().getHours()) =>
  hour < 5 ? "Good night" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

/** Opens a page in the side panel's Browse tab. */
const show = (view: BrowseView) => useBrowseStore.getState().show(view);

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section>
    <h2 className="text-base font-semibold text-white mb-3">{title}</h2>
    {children}
  </section>
);

const Row = ({ children }: { children: ReactNode }) => (
  <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 [scrollbar-width:thin] [scrollbar-color:#404040_transparent]">
    {children}
  </div>
);

const Cover = ({ src, round, children }: { src?: string; round?: boolean; children?: ReactNode }) => (
  <div className={cn("relative w-32 h-32 bg-neutral-800 overflow-hidden", round ? "rounded-full" : "rounded-md")}>
    {/* eslint-disable-next-line @next/next/no-img-element -- external thumbnails, same as SearchResults */}
    {src && <img src={src} alt="" loading="lazy" className="w-full h-full object-cover" />}
    {children}
  </div>
);

/** A quick-play tile: adds the whole collection to the queue. */
const Tile = ({
  icon,
  image,
  title,
  tracks,
}: {
  icon?: ReactNode;
  image?: string;
  title: string;
  tracks: LibraryTrack[];
}) => (
  <button
    type="button"
    onClick={() => addTracksToQueue(tracks)}
    className="group flex items-center gap-3 rounded-md bg-neutral-800/60 hover:bg-neutral-700/70 overflow-hidden text-left cursor-pointer transition-colors"
  >
    <div className="w-14 h-14 flex-shrink-0 bg-neutral-700 flex items-center justify-center">
      {/* eslint-disable-next-line @next/next/no-img-element -- external thumbnails, same as SearchResults */}
      {image ? <img src={image} alt="" className="w-full h-full object-cover" /> : icon}
    </div>
    <span className="flex-1 min-w-0 text-sm font-medium text-white line-clamp-2">{title}</span>
    <Play className="size-8 mr-3 p-2 rounded-full bg-green-500 text-black fill-current opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
  </button>
);

/** The solo home: quick picks from your library, today's mixes, recent plays, top artists and moods. */
export const SoloHome = () => {
  const liked = useLibraryStore((state) => state.liked);
  const playlists = useLibraryStore((state) => state.playlists);
  const history = useLibraryStore((state) => state.history);
  useGlobalStore((state) => state.audioSources); // re-render the "in queue" marks when the queue changes
  const mixes = useDailyMixes();
  const { data: moods } = useQuery({ queryKey: ["browse", "moods"], queryFn: fetchMoods, staleTime: 60 * 60 * 1000 });
  // Library and time of day only exist in the browser: render after hydrating.
  const mounted = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false
  );
  if (!mounted) return null;

  const artists = rankArtists(liked, history).slice(0, TOP_ARTISTS_SHOWN);
  const tilePlaylists = playlists.filter((playlist) => playlist.tracks.length > 0).slice(0, TILE_PLAYLISTS);
  const isNew = liked.length === 0 && history.length === 0 && playlists.length === 0;
  const moodChips = moods?.sections.flatMap((section) => section.categories).slice(0, MOODS_SHOWN) ?? [];

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-white">{greeting()}</h1>

      {isNew && (
        <p className="text-sm text-neutral-400 -mt-4">
          Search for a song above, or pick a mood to get started. Like songs and make playlists to fill this page;
          everything stays on this device.
        </p>
      )}

      {(liked.length > 0 || tilePlaylists.length > 0 || mixes.some((mix) => mix.tracks)) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
          {liked.length > 0 && (
            <Tile
              icon={<Heart className="size-6 fill-current text-white" />}
              title={`Liked songs · ${liked.length}`}
              tracks={liked}
            />
          )}
          {tilePlaylists.map((playlist) => (
            <Tile
              key={playlist.id}
              image={playlist.tracks[0]?.image}
              icon={<ListMusic className="size-6 text-white" />}
              title={playlist.name}
              tracks={playlist.tracks}
            />
          ))}
          {mixes.map(
            (mix) =>
              mix.tracks && <Tile key={mix.title} image={mix.seed.seed.image} title={mix.title} tracks={mix.tracks} />
          )}
        </div>
      )}

      {mixes.length > 0 && (
        <Section title="Made for you">
          <Row>
            {mixes.map((mix, index) => (
              <button
                key={mix.title}
                type="button"
                onClick={() => show({ kind: "mix", index, title: mix.title })}
                className="w-32 flex-shrink-0 text-left cursor-pointer group"
              >
                <Cover src={mix.seed.seed.image}>
                  <span className="absolute bottom-1.5 left-1.5 right-1.5 flex items-center gap-1 text-xs font-semibold text-white bg-black/60 rounded px-1.5 py-0.5">
                    <Sparkles className="size-3" /> {mix.title}
                  </span>
                </Cover>
                <p className="mt-1.5 text-xs text-neutral-400 line-clamp-2 group-hover:text-neutral-200">
                  {mixArtists(mix)}
                </p>
              </button>
            ))}
          </Row>
        </Section>
      )}

      {history.length > 0 && (
        <Section title="Recently played">
          <Row>
            {history.slice(0, RECENT_SHOWN).map((track) => (
              <button
                key={track.id}
                type="button"
                title={isTrackQueued(track) ? "Already in the queue" : "Add to the queue"}
                onClick={() => {
                  if (isTrackQueued(track)) toast.info("Already in the queue");
                  else if (queueLibraryTrack(track)) toast.success(`Added "${track.title}"`);
                }}
                className="w-32 flex-shrink-0 text-left cursor-pointer group"
              >
                <Cover src={track.image} />
                <p className="mt-1.5 text-sm text-white truncate">{track.title}</p>
                <p className="text-xs text-neutral-400 truncate">{track.artist}</p>
              </button>
            ))}
          </Row>
        </Section>
      )}

      {artists.length > 0 && (
        <Section title="Your top artists">
          <Row>
            {artists.map(({ artist, tracks }) => (
              <button
                key={artist}
                type="button"
                onClick={() => show({ kind: "artistByName", name: artist })}
                className="w-32 flex-shrink-0 cursor-pointer group"
              >
                <Cover src={tracks[0]?.image} round />
                <p className="mt-1.5 text-sm text-white text-center truncate group-hover:underline">{artist}</p>
              </button>
            ))}
          </Row>
        </Section>
      )}

      {moodChips.length > 0 && (
        <Section title="Moods & genres">
          <div className="flex flex-wrap gap-2">
            {moodChips.map((category) => (
              <button
                key={category.params}
                type="button"
                onClick={() => show({ kind: "mood", category })}
                className="px-3 py-1.5 rounded-full bg-neutral-800 hover:bg-neutral-700 text-sm text-neutral-200 cursor-pointer"
              >
                {category.title}
              </button>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
};
