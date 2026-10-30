import { extractFileNameFromUrl } from "@/lib/utils";
import { useGlobalStore } from "@/store/global";
import { sendWSRequest } from "@/utils/ws";
import { ClientActionEnum, type TrackType } from "@beatsync/shared";
import { toast } from "sonner";

/**
 * A song saved in the on-device library. Stores what's needed to add it to any
 * room's queue again (queue URLs only live as long as their room).
 */
export interface LibraryTrack {
  id: string | number; // YouTube video ID, or an Apple Music/Qobuz track ID
  title: string;
  artist: string;
  image?: string;
}

// Matches /stream/youtube/<id>/... and the shared R2 key youtube/<id>/...
const YOUTUBE_ID_IN_URL = /youtube\/([A-Za-z0-9_-]{11})\//;

export const youtubeIdFromUrl = (url: string): string | undefined => YOUTUBE_ID_IN_URL.exec(url)?.[1];

export const youtubeThumbnail = (videoId: string) => `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

/** Search results are added as "Artist - Title"; anything else is just a title. */
export const splitTrackName = (name: string) => {
  const separator = name.indexOf(" - ");
  return separator > 0
    ? { artist: name.slice(0, separator), title: name.slice(separator + 3) }
    : { artist: "Beatsync", title: name };
};

export const trackFromSearchResult = (track: TrackType): LibraryTrack => ({
  id: track.id,
  title: track.title,
  artist: track.performer.name,
  image: track.album.image.thumbnail,
});

/** A queued YouTube song as a library track; null for uploads and other one-room files. */
export const trackFromQueueUrl = (url: string): LibraryTrack | null => {
  const videoId = youtubeIdFromUrl(url);
  if (!videoId) return null;
  return { id: videoId, ...splitTrackName(extractFileNameFromUrl(url)), image: youtubeThumbnail(videoId) };
};

/** The queue URL of a library track, if it's already somewhere in the current queue. */
export const queuedUrlFor = (track: LibraryTrack, state = useGlobalStore.getState()): string | undefined =>
  typeof track.id === "string"
    ? state.audioSources.find((source) => youtubeIdFromUrl(source.source.url) === track.id)?.source.url
    : undefined;

/** Whether a library track is already somewhere in the current queue. */
export const isTrackQueued = (track: LibraryTrack): boolean => queuedUrlFor(track) !== undefined;

/** Add a library track to the current room's queue (same request as adding from search). */
export const queueLibraryTrack = (track: LibraryTrack): boolean => {
  const socket = useGlobalStore.getState().socket;
  if (!socket) {
    toast.error("Not connected to server");
    return false;
  }
  return sendWSRequest({
    ws: socket,
    request: {
      type: ClientActionEnum.enum.STREAM_MUSIC,
      trackId: track.id,
      trackName: `${track.artist} - ${track.title}`,
    },
  });
};
