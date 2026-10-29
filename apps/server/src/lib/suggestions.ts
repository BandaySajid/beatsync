import { YOUTUBE_MANAGER } from "@/managers/YoutubeManager";
import type { RoomManager } from "@/managers/RoomManager";
import { sendBroadcast } from "@/utils/responses";
import type { BunServer } from "@/utils/websocket";
import type { TrackType } from "@beatsync/shared";

// Keyed by the room object so a room's suggestions are dropped with the room.
const roomSuggestions = new WeakMap<RoomManager, TrackType[]>();

// Queued YouTube sources are proxy URLs shaped /stream/youtube/<videoId>/<title>.
const isQueued = (room: RoomManager, videoId: string) =>
  room.getAudioSources().some((source) => source.url.includes(`/${videoId}/`));

/** Fetch songs similar to `videoId` and broadcast them to the room. Never throws. */
export async function refreshSuggestions(room: RoomManager, server: BunServer, videoId: string): Promise<void> {
  try {
    const tracks = (await YOUTUBE_MANAGER.getSuggestions(videoId)).filter((t) => !isQueued(room, String(t.id)));
    roomSuggestions.set(room, tracks);
    YOUTUBE_MANAGER.prewarm(tracks.map((t) => String(t.id)));
    sendBroadcast({ server, roomId: room.getRoomId(), message: { type: "SUGGESTIONS", tracks } });
  } catch (error) {
    console.warn(`[YouTube] Failed to load suggestions for ${videoId}:`, error);
  }
}

/** The suggestion to auto-queue when `playingUrl` is the last track in the queue, if any. */
export function pickAutoQueueTrack(room: RoomManager, playingUrl: string): TrackType | undefined {
  const sources = room.getAudioSources();
  if (sources[sources.length - 1]?.url !== playingUrl) return undefined;
  return roomSuggestions.get(room)?.find((t) => !isQueued(room, String(t.id)));
}
