import type { ExtractWSRequestFrom } from "@beatsync/shared";
import { requireRoom } from "@/websocket/middlewares";
import type { HandlerFunction } from "@/websocket/types";

export const handleAudioSourceLoadFailed: HandlerFunction<ExtractWSRequestFrom["AUDIO_SOURCE_LOAD_FAILED"]> = ({
  ws,
  message,
}) => {
  const { room } = requireRoom(ws);
  room.processClientAudioLoadFailed(ws.data.clientId, message.source.url);
};
