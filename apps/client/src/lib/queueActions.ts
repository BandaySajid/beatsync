import { queueLibraryTrack, queuedUrlFor, trackFromQueueUrl, type LibraryTrack } from "@/lib/libraryTrack";
import { useGlobalStore } from "@/store/global";
import { useLibraryStore } from "@/store/library";
import { sendWSRequest } from "@/utils/ws";
import { ClientActionEnum, type AudioSourceType } from "@beatsync/shared";
import { toast } from "sonner";

const PLACEHOLDER_WAIT_MS = 30_000;

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
