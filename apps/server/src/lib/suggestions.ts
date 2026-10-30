import { YOUTUBE_MANAGER } from "@/managers/YoutubeManager";
import type { RoomManager } from "@/managers/RoomManager";
import { sendBroadcast } from "@/utils/responses";
import type { BunServer } from "@/utils/websocket";
import type { ExtractWSResponseFrom, TrackType } from "@beatsync/shared";

interface RoomSuggestions {
  tracks: TrackType[];
  autoQueue: boolean;
}

// Keyed by the room object so a room's suggestions are dropped with the room.
// shortcut: not in room backups, so a restart clears suggestions and turns auto-queue back on.
const roomSuggestions = new WeakMap<RoomManager, RoomSuggestions>();

const getRoomSuggestions = (room: RoomManager): RoomSuggestions =>
  roomSuggestions.get(room) ?? { tracks: [], autoQueue: true };

/** The room's suggestions panel state, sent to everyone on change and to each client on join. */
export const suggestionsMessage = (room: RoomManager): ExtractWSResponseFrom["SUGGESTIONS"] => ({
  type: "SUGGESTIONS",
  ...getRoomSuggestions(room),
});

const update = (room: RoomManager, server: BunServer, change: Partial<RoomSuggestions>) => {
  roomSuggestions.set(room, { ...getRoomSuggestions(room), ...change });
  sendBroadcast({ server, roomId: room.getRoomId(), message: suggestionsMessage(room) });
};

// Queued YouTube sources carry the video ID: /stream/youtube/<id>/... while preparing,
// then .../youtube/<id>/<title>___yt.m4a once moved to R2. 11-char IDs make collisions negligible.
const isQueued = (room: RoomManager, videoId: string) =>
  room.getAudioSources().some((source) => source.url.includes(videoId));

/** Fetch songs similar to `videoId` and broadcast them to the room. Never throws. */
export async function refreshSuggestions(room: RoomManager, server: BunServer, videoId: string): Promise<void> {
  try {
    const tracks = (await YOUTUBE_MANAGER.getSuggestions(videoId)).filter((t) => !isQueued(room, String(t.id)));
    YOUTUBE_MANAGER.prewarm(tracks.map((t) => String(t.id)));
    update(room, server, { tracks });
  } catch (error) {
    console.warn(`[YouTube] Failed to load suggestions for ${videoId}:`, error);
  }
}

export function setAutoQueue(room: RoomManager, server: BunServer, autoQueue: boolean): void {
  update(room, server, { autoQueue });
}

/** The suggestion to auto-queue when `playingUrl` is the last track in the queue, if any. */
export function pickAutoQueueTrack(room: RoomManager, playingUrl: string): TrackType | undefined {
  const { tracks, autoQueue } = getRoomSuggestions(room);
  const sources = room.getAudioSources();
  if (!autoQueue || sources[sources.length - 1]?.url !== playingUrl) return undefined;
  return tracks.find((t) => !isQueued(room, String(t.id)));
}
