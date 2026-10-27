import { WSRequestType } from "@beatsync/shared";

export const sendWSRequest = ({ ws, request }: { ws: WebSocket; request: WSRequestType }): boolean => {
  // During a reconnect the store can still hold the previous, closed socket.
  // Sending on it throws InvalidStateError and can break the caller's control
  // flow (heartbeat chains, load completion handlers, etc.).
  if (ws.readyState !== WebSocket.OPEN) {
    console.warn(`[WS] Dropping ${request.type}: socket is not open (readyState=${ws.readyState})`);
    return false;
  }

  ws.send(JSON.stringify(request));
  return true;
};
