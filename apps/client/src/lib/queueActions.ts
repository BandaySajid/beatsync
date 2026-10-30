import { fetchRadio } from "@/lib/api";
import {
  isTrackQueued,
  queueLibraryTrack,
  queuedUrlFor,
  trackFromQueueUrl,
  trackFromSearchResult,
  youtubeIdFromUrl,
  type LibraryTrack,
} from "@/lib/libraryTrack";
import { useGlobalStore } from "@/store/global";
import { useLibraryStore } from "@/store/library";
import { sendWSRequest } from "@/utils/ws";
import { ClientActionEnum, type AudioSourceType } from "@beatsync/shared";
import { toast } from "sonner";

const PLACEHOLDER_WAIT_MS = 30_000;
const SMART_SHUFFLE_EVERY = 3; // One recommended song after every 3 of yours
// shortcut: each added song makes the server resolve + download it; keep the batch small.
const SMART_SHUFFLE_MAX = 5;

/** The queue with `url` moved to right after the current song (or to the front if none). */
export const orderWithNext = (sources: AudioSourceType[], url: string, currentUrl: string): AudioSourceType[] => {
  const moving = sources.find((source) => source.url === url);
  if (!moving || url === currentUrl) return sources;
  const rest = sources.filter((source) => source.url !== url);
  rest.splice(rest.findIndex((source) => source.url === currentUrl) + 1, 0, moving);
  return rest;
};

const moveAfterCurrent = (url: string) => {
  const state = useGlobalStore.getState();
  // Full source objects: a song that is still preparing must keep its `preparing` flag.
  state.broadcastReorder(
    orderWithNext(
      state.audioSources.map((as) => as.source),
      url,
      state.selectedAudioUrl
    )
  );
};

/** Play `track` right after the current song: move it if it's queued, otherwise add it and then move it. */
export const playNext = (track: LibraryTrack) => {
  const queuedUrl = queuedUrlFor(track);
  if (queuedUrl) {
    moveAfterCurrent(queuedUrl);
    toast.success(`"${track.title}" plays next`);
    return;
  }
  if (!queueLibraryTrack(track)) return;

  // The server appends a placeholder for the new song; move it once it shows up.
  let unsubscribe = () => {};
  const timeout = setTimeout(() => unsubscribe(), PLACEHOLDER_WAIT_MS);
  unsubscribe = useGlobalStore.subscribe((state) => {
    const url = queuedUrlFor(track, state);
    if (!url) return;
    clearTimeout(timeout);
    unsubscribe();
    moveAfterCurrent(url);
  });
  toast.success(`"${track.title}" plays next`);
};

/**
 * The queue with the songs after the current one shuffled, and a recommended song after
 * every SMART_SHUFFLE_EVERY of yours. Songs up to and including the current one stay put.
 */
export const smartShuffleOrder = (
  sources: AudioSourceType[],
  currentUrl: string,
  recommendedUrls: Set<string>,
  random = Math.random
): AudioSourceType[] => {
  const split = sources.findIndex((source) => source.url === currentUrl) + 1;
  const upcoming = sources.slice(split);
  const yours = upcoming.filter((source) => !recommendedUrls.has(source.url));
  const recommended = upcoming.filter((source) => recommendedUrls.has(source.url));
  // Fisher-Yates: an unbiased shuffle
  for (let i = yours.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [yours[i], yours[j]] = [yours[j], yours[i]];
  }
  const mixed: AudioSourceType[] = [];
  yours.forEach((source, index) => {
    mixed.push(source);
    if ((index + 1) % SMART_SHUFFLE_EVERY === 0 && recommended.length > 0) mixed.push(recommended.shift()!);
  });
  return [...sources.slice(0, split), ...mixed, ...recommended];
};

/**
 * Smart shuffle: shuffle what's coming up and mix in songs like the one playing, taken from
 * its YouTube Music radio. The new songs are added first, then the whole queue is reordered
 * once their placeholders show up.
 */
export const smartShuffle = async ({ getRadio = fetchRadio, random = Math.random } = {}) => {
  const state = useGlobalStore.getState();
  const urls = state.audioSources.map((as) => as.source.url);
  const upcoming = urls.slice(urls.indexOf(state.selectedAudioUrl) + 1);
  // Recommend from the song playing, or the first YouTube song in the queue.
  const seedId = [state.selectedAudioUrl, ...urls].map(youtubeIdFromUrl).find(Boolean);
  const wanted = Math.min(SMART_SHUFFLE_MAX, Math.max(1, Math.ceil(upcoming.length / SMART_SHUFFLE_EVERY)));

  let picks: LibraryTrack[] = [];
  if (seedId) {
    try {
      const { tracks } = await getRadio(seedId);
      picks = tracks
        .map(trackFromSearchResult)
        .filter((track) => !isTrackQueued(track))
        .slice(0, wanted);
    } catch {
      toast.error("Couldn't get recommendations; shuffled your songs only");
    }
  }

  const reorder = (recommendedUrls: Set<string>) => {
    const latest = useGlobalStore.getState();
    // Full source objects: a song that is still preparing must keep its `preparing` flag.
    latest.broadcastReorder(
      smartShuffleOrder(
        latest.audioSources.map((as) => as.source),
        latest.selectedAudioUrl,
        recommendedUrls,
        random
      )
    );
  };

  const added = picks.filter(queueLibraryTrack);
  if (added.length === 0) {
    reorder(new Set());
    toast.success("Shuffled the queue");
    return;
  }

  // Wait for the server's placeholders, then reorder once (with whatever arrived in time).
  await new Promise<void>((resolve) => {
    let unsubscribe = () => {};
    const finish = () => {
      clearTimeout(timeout);
      unsubscribe();
      const latest = useGlobalStore.getState();
      reorder(new Set(added.flatMap((track) => queuedUrlFor(track, latest) ?? [])));
      resolve();
    };
    const timeout = setTimeout(finish, PLACEHOLDER_WAIT_MS);
    unsubscribe = useGlobalStore.subscribe((latest) => {
      if (added.every((track) => queuedUrlFor(track, latest))) finish();
    });
  });
  toast.success(`Smart shuffle: mixed in ${added.length} recommended song${added.length === 1 ? "" : "s"}`);
};

/** Remove everything from the queue except the song that is playing (or selected). */
export const clearUpcoming = () => {
  const { audioSources, selectedAudioUrl, socket } = useGlobalStore.getState();
  const urls = audioSources.map((as) => as.source.url).filter((url) => url !== selectedAudioUrl);
  if (!socket || urls.length === 0) return;
  sendWSRequest({ ws: socket, request: { type: ClientActionEnum.enum.DELETE_AUDIO_SOURCES, urls } });
};

/** Save the queue's YouTube songs as a new on-device playlist. Returns how many were saved. */
export const saveQueueAsPlaylist = (): number => {
  const tracks = useGlobalStore
    .getState()
    .audioSources.map((as) => trackFromQueueUrl(as.source.url))
    .filter((track): track is LibraryTrack => track !== null);
  if (tracks.length === 0) return 0;
  const name = `Saved queue · ${new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  useLibraryStore.getState().createPlaylist(name, tracks);
  return tracks.length;
};
