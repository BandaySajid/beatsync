import type { ExtractWSRequestFrom } from "@beatsync/shared/types/WSRequest";
import { setAutoQueue } from "@/lib/suggestions";
import { requireCanMutate } from "@/websocket/middlewares";
import type { HandlerFunction } from "@/websocket/types";

export const handleSetAutoQueue: HandlerFunction<ExtractWSRequestFrom["SET_AUTO_QUEUE"]> = ({
  ws,
  message,
  server,
}) => {
  const { room } = requireCanMutate(ws);
  setAutoQueue(room, server, message.enabled);
};
