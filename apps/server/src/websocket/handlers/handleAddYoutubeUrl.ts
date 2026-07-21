import { IS_DEMO_MODE } from "@/demo";
import { globalManager } from "@/managers";
import { YOUTUBE_MANAGER, YoutubeManager } from "@/managers/YoutubeManager";
import { sendBroadcast } from "@/utils/responses";
import type { HandlerFunction } from "@/websocket/types";
import type { ExtractWSRequestFrom } from "@beatsync/shared";

export const handleAddYoutubeUrl: HandlerFunction<ExtractWSRequestFrom["ADD_YOUTUBE_URL"]> = async ({
  ws,
  message,
  server,
}) => {
  if (IS_DEMO_MODE) return;

  const roomId = ws.data.roomId;
  const room = globalManager.getRoom(roomId);
  if (!room) {
    console.error(`[YouTube] Add request failed: Room ${roomId} not found`);
    return;
  }

  const { youtubeUrl } = message;

  // Validate it's actually a YouTube URL
  if (!YoutubeManager.isYoutubeUrl(youtubeUrl)) {
    console.warn(`[YouTube] Rejected non-YouTube URL: ${youtubeUrl}`);
    return;
  }

  // Deduplicate: ignore if already being processed
  if (room.hasActiveStreamJob(youtubeUrl)) {
    console.log(`[YouTube] Already processing ${youtubeUrl} for room ${roomId}, ignoring duplicate`);
    return;
  }

  room.addStreamJob(youtubeUrl);
  sendBroadcast({
    server,
    roomId,
    message: {
      type: "STREAM_JOB_UPDATE",
      activeJobCount: room.getActiveStreamJobCount(),
    },
  });

  try {
    console.log(`[YouTube] Extracting stream for: ${youtubeUrl}`);
    const { publicUrl, title } = await YOUTUBE_MANAGER.addStreamAndUpload(youtubeUrl, roomId);

    const sources = room.addAudioSource({ url: publicUrl });

    console.log(`[YouTube] Added "${title}" to room ${roomId} — ${sources.length} total sources`);

    sendBroadcast({
      server,
      roomId,
      message: {
        type: "ROOM_EVENT",
        event: {
          type: "SET_AUDIO_SOURCES",
          sources,
        },
      },
    });
  } catch (error) {
    console.error(`[YouTube] Failed to process ${youtubeUrl}:`, error);
  } finally {
    room.removeStreamJob(youtubeUrl);
    sendBroadcast({
      server,
      roomId,
      message: {
        type: "STREAM_JOB_UPDATE",
        activeJobCount: room.getActiveStreamJobCount(),
      },
    });
  }
};
