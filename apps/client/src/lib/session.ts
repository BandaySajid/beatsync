import { queueLibraryTrack, trackFromQueueUrl, youtubeIdFromUrl, type LibraryTrack } from "@/lib/libraryTrack";
import { useGlobalStore } from "@/store/global";
import { useLibraryStore, type LastSession } from "@/store/library";

// Same reasoning as the library's "add all" cap: every re-added song is resolved and downloaded.
export const RESTORE_LIMIT = 20;
const RESUME_TIMEOUT_MS = 60_000;

// While a resume re-adds songs the queue is half-filled; a snapshot then would overwrite the
// saved position, so snapshots wait until the resume is done.
let resumeInProgress = false;

/** The current solo queue, song and position, or null if there's nothing worth saving. */
export const snapshotSession = (): LastSession | null => {
  if (resumeInProgress) return null;
  const state = useGlobalStore.getState();
  const tracks = state.audioSources
    .map((source) => trackFromQueueUrl(source.source.url))
    .filter((track): track is LibraryTrack => track !== null);
  if (tracks.length === 0) return null;
  return {
    tracks,
    currentId: trackFromQueueUrl(state.selectedAudioUrl)?.id,
    positionSeconds: state.getCurrentTrackPosition(),
    savedAt: Date.now(),
  };
};

export const saveSessionSnapshot = () => {
  const snapshot = snapshotSession();
  if (snapshot) useLibraryStore.getState().saveLastSession(snapshot);
};

/** The saved songs to re-add: at most `limit`, always including the one you were listening to. */
export const tracksToRestore = (session: LastSession, limit = RESTORE_LIMIT): LibraryTrack[] => {
  const currentIndex = Math.max(
    0,
    session.tracks.findIndex((track) => track.id === session.currentId)
  );
  const start = Math.max(0, Math.min(currentIndex, session.tracks.length - limit));
  return session.tracks.slice(start, start + limit);
};

/**
 * Re-add a saved session's songs to this (new, empty) room, then start the song you were
 * listening to at the saved position as soon as the server has it ready.
 */
export const resumeSession = (session: LastSession) => {
  tracksToRestore(session).forEach(queueLibraryTrack);
  if (session.currentId === undefined) return;

  resumeInProgress = true;
  let unsubscribe = () => {};
  const finish = () => {
    clearTimeout(timeout);
    unsubscribe();
    resumeInProgress = false;
  };
  const timeout = setTimeout(finish, RESUME_TIMEOUT_MS);

  const playWhenReady = (state: ReturnType<typeof useGlobalStore.getState>) => {
    const source = state.audioSources.find(
      (candidate) => !candidate.source.preparing && youtubeIdFromUrl(candidate.source.url) === session.currentId
    );
    if (!source) return;
    finish();
    state.changeAudioSource(source.source.url);
    state.broadcastPlay(session.positionSeconds);
  };
  unsubscribe = useGlobalStore.subscribe(playWhenReady);
};
