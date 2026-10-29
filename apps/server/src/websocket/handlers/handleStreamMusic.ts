import { IS_DEMO_MODE } from "@/demo";
import { generateAudioFileName, uploadBytes } from "@/lib/r2";
import { refreshSuggestions } from "@/lib/suggestions";
import { globalManager } from "@/managers";
import { MUSIC_PROVIDER_MANAGER } from "@/managers/MusicProviderManager";
import { YoutubeManager } from "@/managers/YoutubeManager";
import { sendBroadcast } from "@/utils/responses";
import type { HandlerFunction } from "@/websocket/types";
import type { ExtractWSRequestFrom } from "@beatsync/shared";
import { prepareYoutubeAudioToR2 } from "@/websocket/handlers/youtubeAudioPipeline";

export const handleStreamMusic: HandlerFunction<ExtractWSRequestFrom["STREAM_MUSIC"]> = async ({
  ws,
  message,
  server,
}) => {
  if (IS_DEMO_MODE) return;
  const roomId = ws.data.roomId;

  // Require room to exist before processing stream request
  const room = globalManager.getRoom(roomId);
  if (!room) {
    console.error(`Stream request failed: Room ${roomId} not found`);
    return;
  }

  // Check if this track is already being streamed
  const trackId = message.trackId.toString();
  if (room.hasActiveStreamJob(trackId)) {
    console.log(`Track ${trackId} is already being streamed for room ${roomId}, ignoring duplicate request`);
    return;
  }

  // Add job to room and broadcast updated count
  room.addStreamJob(trackId);
  sendBroadcast({
    server,
    roomId,
    message: {
      type: "STREAM_JOB_UPDATE",
      activeJobCount: room.getActiveStreamJobCount(),
    },
  });

  if (typeof message.trackId === "string") {
    // YouTube: add an instantly visible placeholder, then let the background
    // pipeline produce the audio-only R2 file. The client skips preparing rows,
    // so it never downloads the muxed video while this runs.
    const videoId = message.trackId;
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
      console.error(`Invalid YouTube video ID: ${videoId}`);
      room.removeStreamJob(trackId);
      sendBroadcast({
        server,
        roomId,
        message: {
          type: "STREAM_JOB_UPDATE",
          activeJobCount: room.getActiveStreamJobCount(),
        },
      });
      return;
    }

    const title = message.trackName ?? "YouTube Track";
    const audioUrl = YoutubeManager.getStreamUrl(videoId, title);
    const sources = room.addAudioSource({ url: audioUrl, preparing: true });

    console.log(`[YouTube] Preparing "${title}" (${videoId}) in the background`);

    sendBroadcast({
      server,
      roomId,
      message: {
        type: "ROOM_EVENT",
        event: {
          type: "SET_AUDIO_SOURCES",
          sources,
          currentAudioSource:
            room.getPlaybackState().type === "playing" ? room.getPlaybackState().audioSource : undefined,
        },
      },
    });

    void prepareYoutubeAudioToR2({ roomId, videoId, title, placeholderUrl: audioUrl, server })
      .catch((error) => console.error(`[YouTube] Background preparation failed for ${videoId}:`, error))
      .finally(() => {
        room.removeStreamJob(trackId);
        sendBroadcast({
          server,
          roomId,
          message: {
            type: "STREAM_JOB_UPDATE",
            activeJobCount: room.getActiveStreamJobCount(),
          },
        });
      });
    return;
  }

  try {
    // It's an Apple Music / Qobuz track
    const streamResponse = await MUSIC_PROVIDER_MANAGER.stream(message.trackId);

    if (!streamResponse.success) {
      throw new Error("Failed to get stream URL");
    }

    const streamUrl = streamResponse.data.url;

    // Use provided track name or fallback to track ID
    const originalName = message.trackName ?? `track-${message.trackId}`;

    // Download the audio file
    console.log(`Downloading audio from: ${streamUrl}`);
    const response = await fetch(streamUrl);

    // Generate a unique filename for R2
    const fileName = generateAudioFileName(`${originalName}.mp3`);

    if (!response.ok) {
      throw new Error(`Failed to download audio: ${response.status}`);
    }

    // Get audio bytes
    const arrayBuffer = await response.arrayBuffer();

    // Get content type from response headers, fallback to audio/mpeg
    const contentType = response.headers.get("content-type") ?? "audio/mpeg";

    // Upload directly to R2
    console.log(`Uploading to R2: room-${roomId}/${fileName}`);
    const audioUrl = await uploadBytes(arrayBuffer, roomId, fileName, contentType);

    // Add the audio source to the room and get updated sources list
    const sources = room.addAudioSource({ url: audioUrl });

    console.log(`Successfully added audio source: ${audioUrl}`);
    console.log(`Broadcasting new audio sources to room ${roomId}: ${sources.length} total sources`);

    // Broadcast to all room members that new audio is available
    sendBroadcast({
      server,
      roomId,
      message: {
        type: "ROOM_EVENT",
        event: {
          type: "SET_AUDIO_SOURCES",
          sources,
          currentAudioSource:
            room.getPlaybackState().type === "playing" ? room.getPlaybackState().audioSource : undefined,
        },
      },
    });

    // shortcut: suggestions only for YouTube tracks; Apple Music/Qobuz IDs have no radio to seed from.
    if (typeof message.trackId === "string") void refreshSuggestions(room, server, message.trackId);
  } catch (error) {
    console.error("Error in handleStreamMusic:", error);
  } finally {
    // Job completed or failed - remove from tracking and notify clients
    room.removeStreamJob(trackId);
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
