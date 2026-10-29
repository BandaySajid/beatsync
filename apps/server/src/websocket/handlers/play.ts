import type { ExtractWSRequestFrom } from "@beatsync/shared";
import { IS_DEMO_MODE } from "@/demo";
import { pickAutoQueueTrack } from "@/lib/suggestions";
import { handleStreamMusic } from "@/websocket/handlers/handleStreamMusic";
import { requireCanMutate } from "@/websocket/middlewares";
import type { HandlerFunction } from "@/websocket/types";

export const handlePlay: HandlerFunction<ExtractWSRequestFrom["PLAY"]> = ({ ws, message, server }) => {
  const { room } = requireCanMutate(ws);

  // Last track just started: queue a similar song now so playback keeps going.
  // handleStreamMusic dedupes by track ID, so pause/resume on the last track can't double-add.
  const next = IS_DEMO_MODE ? undefined : pickAutoQueueTrack(room, message.audioSource);
  if (next) {
    const trackName = `${next.performer.name} - ${next.title}`;
    void handleStreamMusic({ ws, message: { type: "STREAM_MUSIC", trackId: next.id, trackName }, server });
  }

  if (IS_DEMO_MODE) {
    // Skip audio loading coordination — audio is pre-cached on clients.
    // Broadcast play immediately to avoid 3s timeout dead air on stage.
    room.executeImmediatePlay(message, server);
  } else {
    // Initiate audio loading for all clients
    // The play will be executed after all clients load or timeout
    room.initiateAudioSourceLoad(message, ws.data.clientId, server);
  }
};
