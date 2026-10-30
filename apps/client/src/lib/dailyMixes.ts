import type { LibraryTrack } from "@/lib/libraryTrack";

export const MIX_COUNT = 4;
const OWN_PER_MIX = 6; // Songs of yours in each mix; the rest comes from YouTube Music's radio
const MIX_SIZE = 30;
const STORAGE_KEY = "beatsync:daily-mixes-v1";
// Placeholder artists of uploads and unnamed videos, not real artists
const UNKNOWN_ARTISTS = new Set(["youtube", "beatsync"]);

/** One daily mix: an artist you listen to, today's seed song for its radio, and your songs by them. */
export interface MixSeed {
  artist: string;
  seed: LibraryTrack & { id: string };
  own: LibraryTrack[];
}

/** Today in local time, e.g. "2026-10-30": mixes change once a day. */
export const today = (now = new Date()) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

/** A small seeded random generator (mulberry32), so a day's mixes come out the same all day. */
const seededRandom = (seed: string) => {
  let state = 0;
  for (let i = 0; i < seed.length; i++) state = (Math.imul(state, 31) + seed.charCodeAt(i)) | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const artistName = (name: string) => name.replace(/ - Topic$/i, "").trim();

export interface RankedArtist {
  artist: string;
  score: number;
  tracks: (LibraryTrack & { id: string })[]; // Their YouTube songs in your library, newest first
}

/** The artists you listen to most, most first: a liked song counts 2, a recent play 1. */
export const rankArtists = (liked: LibraryTrack[], history: LibraryTrack[]): RankedArtist[] => {
  const byArtist = new Map<string, RankedArtist>();
  const add = (track: LibraryTrack, weight: number) => {
    const { id } = track;
    if (typeof id !== "string") return; // only YouTube songs have a radio
    const artist = artistName(track.artist);
    const key = artist.toLowerCase();
    if (!key || UNKNOWN_ARTISTS.has(key)) return;
    const entry = byArtist.get(key) ?? { artist, score: 0, tracks: [] };
    entry.score += weight;
    if (!entry.tracks.some((existing) => existing.id === id)) entry.tracks.push({ ...track, id });
    byArtist.set(key, entry);
  };
  liked.forEach((track) => add(track, 2));
  history.forEach((track) => add(track, 1));
  return [...byArtist.values()].sort((a, b) => b.score - a.score || a.artist.localeCompare(b.artist));
};

/** The artists you listen to most, each with a seed song for the day. */
export const pickMixSeeds = (liked: LibraryTrack[], history: LibraryTrack[], day: string): MixSeed[] => {
  const random = seededRandom(day);
  return rankArtists(liked, history)
    .slice(0, MIX_COUNT)
    .map(({ artist, tracks }) => ({
      artist,
      seed: tracks[Math.floor(random() * tracks.length)],
      own: tracks.slice(0, OWN_PER_MIX),
    }));
};

/** Your songs plus the seed's radio, without repeats, in an order that changes daily. */
export const blendMix = (mix: MixSeed, radio: LibraryTrack[], day: string): LibraryTrack[] => {
  const seen = new Set<LibraryTrack["id"]>();
  const tracks = [...mix.own, ...radio]
    .filter((track) => !seen.has(track.id) && !!seen.add(track.id))
    .slice(0, MIX_SIZE);
  const random = seededRandom(`${day}:${mix.artist}`);
  for (let i = tracks.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
  }
  return tracks;
};

/**
 * Today's mix seeds, picked once a day and kept on this device: picking again as you play
 * would reshuffle a mix while you're listening to it.
 */
export const todaysMixSeeds = (liked: LibraryTrack[], history: LibraryTrack[], day = today()): MixSeed[] => {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as { day: string; seeds: MixSeed[] } | null;
    if (saved?.day === day && saved.seeds.length > 0) return saved.seeds;
  } catch {
    // Unreadable or no storage: pick again below.
  }
  const seeds = pickMixSeeds(liked, history, day);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ day, seeds }));
  } catch {
    // Best-effort only.
  }
  return seeds;
};
