import { getPublicUrlForKey, listObjectsWithPrefix, uploadFileToKey } from "@/lib/r2";
import { globalManager } from "@/managers";
import { YOUTUBE_MANAGER } from "@/managers/YoutubeManager";
import { sendBroadcast } from "@/utils/responses";
import type { BunServer } from "@/utils/websocket";
import { R2_AUDIO_FILE_NAME_DELIMITER } from "@beatsync/shared";

const R2_CACHE_CONTROL = "public, max-age=31536000, immutable";

const broadcastSources = (roomId: string, server: BunServer, placeholderUrl: string, r2Url?: string): void => {
  const room = globalManager.getRoom(roomId);
  if (!room) return;

  const sources = room.replaceAudioSource(placeholderUrl, r2Url ? { url: r2Url } : { url: placeholderUrl });
  if (!sources) return;

  sendBroadcast({
    server,
    roomId,
    message: {
      type: "ROOM_EVENT",
      event: {
        type: "SET_AUDIO_SOURCES",
        sources,
        currentAudioSource: room.getPlaybackState().audioSource || undefined,
        ...(r2Url ? { replacedSources: [{ from: placeholderUrl, to: r2Url }] } : {}),
      },
    },
  });
};

/**
 * Turn a YouTube placeholder queue entry into a durable, audio-only R2 file.
 *
 * The reliable YouTube stream on this host is muxed (video + 128kbps AAC).
 * We download it with the parallel range fetcher, strip the video with ffmpeg,
 * upload only the audio, and swap the room's source URL. Clients never fetch
 * the video bytes, and refreshes/restarts reuse the R2 object.
 */
export async function prepareYoutubeAudioToR2({
  roomId,
  videoId,
  title,
  placeholderUrl,
  server,
}: {
  roomId: string;
  videoId: string;
  title: string;
  placeholderUrl: string;
  server: BunServer;
}): Promise<void> {
  const room = globalManager.getRoom(roomId);
  if (!room?.getAudioSources().some((source) => source.url === placeholderUrl)) return;

  // Keep the human title in the object name so the queue UI (which derives its
  // label from the URL) shows the song title, not a bare video ID.
  const safeTitle =
    title
      .replace(/[/\\?%*:|"<>]/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 100) || "YouTube Track";
  // Shared across rooms (outside room-<id>/, so room cleanup never deletes it): any room
  // that adds this video again reuses the upload. Expire the youtube/ prefix with an R2
  // lifecycle rule, since nothing else deletes it.
  const prefix = `youtube/${videoId}/`;
  const key = `${prefix}${safeTitle}${R2_AUDIO_FILE_NAME_DELIMITER}yt.m4a`;
  const r2Url = getPublicUrlForKey(key);

  try {
    // Listing the prefix finds the upload even if it was saved under a different title.
    const existingKey = (await listObjectsWithPrefix(prefix))?.[0]?.Key;
    if (existingKey) {
      console.log(`[YouTube] Reusing shared R2 audio for ${videoId} at ${existingKey}`);
      broadcastSources(roomId, server, placeholderUrl, getPublicUrlForKey(existingKey));
      return;
    }

    const cachePath = await YOUTUBE_MANAGER.preloadVideo(videoId);
    if (!cachePath) {
      console.warn(`[YouTube] Could not prepare audio-only file for ${videoId}; keeping the stream fallback`);
      broadcastSources(roomId, server, placeholderUrl);
      return;
    }

    // The room may have been cleaned up or the track removed while downloading.
    const currentRoom = globalManager.getRoom(roomId);
    if (!currentRoom?.getAudioSources().some((source) => source.url === placeholderUrl)) {
      return;
    }

    // Playable now: the /stream route serves this local audio-only file while R2 uploads.
    // Clients keep the decoded buffer across the R2 swap below, so nobody downloads twice.
    broadcastSources(roomId, server, placeholderUrl);

    const startedAt = performance.now();
    await uploadFileToKey(cachePath, key, "audio/mp4", { roomId, videoId, source: "youtube" }, R2_CACHE_CONTROL);
    console.log(
      `[YouTube] Uploaded audio-only ${videoId} to R2 in ${(performance.now() - startedAt).toFixed(0)}ms (${key})`
    );

    broadcastSources(roomId, server, placeholderUrl, r2Url);
  } catch (error) {
    console.error(`[YouTube] R2 preparation failed for ${videoId}:`, error);
    broadcastSources(roomId, server, placeholderUrl);
  }
}
