import { IS_DEMO_MODE } from "@/demo";
import { refreshSuggestions } from "@/lib/suggestions";
import { globalManager } from "@/managers";
import { YOUTUBE_MANAGER, YoutubeManager } from "@/managers/YoutubeManager";
import { sendBroadcast } from "@/utils/responses";
import type { HandlerFunction } from "@/websocket/types";
import type { ExtractWSRequestFrom } from "@beatsync/shared";
import { prepareYoutubeAudioToR2 } from "@/websocket/handlers/youtubeAudioPipeline";

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
    console.log(`[YouTube] Resolving stream for: ${youtubeUrl}`);
    const videoId = YoutubeManager.getVideoId(youtubeUrl);
    const { publicUrl, title } = await YOUTUBE_MANAGER.getStreamSource(youtubeUrl);

    if (!videoId) {
      throw new Error("Unable to determine YouTube video ID");
    }

    const sources = room.addAudioSource({ url: publicUrl, preparing: true });

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

    void prepareYoutubeAudioToR2({ roomId, videoId, title, placeholderUrl: publicUrl, server })
      .catch((error) => console.error(`[YouTube] Background preparation failed for ${videoId}:`, error))
      .finally(() => {
        room.removeStreamJob(youtubeUrl);
        sendBroadcast({
          server,
          roomId,
          message: {
            type: "STREAM_JOB_UPDATE",
            activeJobCount: room.getActiveStreamJobCount(),
          },
        });
      });
  } catch (error) {
    console.error(`[YouTube] Failed to process ${youtubeUrl}:`, error);
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
