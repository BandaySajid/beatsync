import type { ExtractWSRequestFrom } from "@beatsync/shared";
import { YOUTUBE_MANAGER } from "@/managers/YoutubeManager";
import { requireRoom } from "@/websocket/middlewares";
import type { HandlerFunction } from "@/websocket/types";

export const handleAudioSourceLoaded: HandlerFunction<ExtractWSRequestFrom["AUDIO_SOURCE_LOADED"]> = ({
  ws,
  server,
  message,
}) => {
  const { room } = requireRoom(ws);

  // Process that this client has loaded the audio source
  room.processClientLoadedAudioSource(ws.data.clientId, server, message.source.url);

  // The client now has the full buffer. Warm the server-side cache in the
  // background for replays and other clients without competing with the
  // first play's stream.
  const streamMatch = /\/stream\/youtube\/([A-Za-z0-9_-]{11})(?:\/|$)/.exec(message.source.url);
  if (streamMatch) {
    void YOUTUBE_MANAGER.preloadVideo(streamMatch[1]);
  }
};
