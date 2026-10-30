import { useGlobalStore } from "@/store/global";
import { useRoomStore } from "@/store/room";

/**
 * Show the personal (solo) layout: a solo session with nobody else in it.
 * As soon as an invited friend joins, everyone gets the full room layout.
 */
export const useIsSoloLayout = (): boolean => {
  const isSolo = useRoomStore((state) => state.isSolo);
  const connectedClientCount = useGlobalStore((state) => state.connectedClients.length);
  return isSolo && connectedClientCount <= 1;
};
