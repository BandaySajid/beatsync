"use client";
import { useClientId } from "@/hooks/useClientId";
import { useNtpHeartbeat } from "@/hooks/useNtpHeartbeat";
import { useWebSocketReconnection } from "@/hooks/useWebSocketReconnection";
import { IS_DEMO_MODE } from "@/lib/demo";
import { getUserLocation } from "@/lib/ip";
import { getWsUrl } from "@/lib/urls";
import { useGlobalStore } from "@/store/global";
import { useRoomStore } from "@/store/room";
import { sendWSRequest } from "@/utils/ws";
import { ClientActionEnum, WSResponseSchema } from "@beatsync/shared";
import { dispatchWSResponse } from "@/websocket/dispatch";
import { useEffect } from "react";

interface WebSocketManagerProps {
  roomId: string;
  username: string;
}

export const WebSocketManager = ({ roomId, username }: WebSocketManagerProps) => {
  // Get PostHog client ID
  const { clientId } = useClientId();

  // Room state
  const isLoadingRoom = useRoomStore((state) => state.isLoadingRoom);

  // WebSocket state (message handling lives in @/websocket/registry)
  const setSocket = useGlobalStore((state) => state.setSocket);

  // Use the NTP heartbeat hook
  const { startHeartbeat, stopHeartbeat, markNTPResponseReceived } = useNtpHeartbeat({
    onConnectionStale: () => {
      const currentSocket = useGlobalStore.getState().socket;
      if (currentSocket && currentSocket.readyState === WebSocket.OPEN) {
        currentSocket.close();
      }
    },
  });

  // Use the WebSocket reconnection hook
  const {
    onConnectionOpen,
    scheduleReconnection,
    reconnectNow,
    cleanup: cleanupReconnection,
  } = useWebSocketReconnection({
    createConnection: () => createConnection(),
  });

  // Cache secrets from page URL (don't change across reconnections)
  const isClient = typeof window !== "undefined";
  const searchParams = isClient ? new URLSearchParams(window.location.search) : null;
  const adminSecret = searchParams?.get("admin") ?? null;
  // Check URL param first, then localStorage (set once via: localStorage.setItem("creatorSecret", "..."))
  const creatorSecret = searchParams?.get("creator") ?? (isClient ? localStorage.getItem("creatorSecret") : null);
  const adminParam = adminSecret ? `&admin=${encodeURIComponent(adminSecret)}` : "";
  const creatorParam = creatorSecret ? `&creator=${encodeURIComponent(creatorSecret)}` : "";

  const createConnection = () => {
    // Never tear down a healthy connection. The effect, bfcache handler and
    // reconnect hook can all fire around the same moment; only one socket wins.
    const previous = useGlobalStore.getState().socket;
    if (previous && (previous.readyState === WebSocket.OPEN || previous.readyState === WebSocket.CONNECTING)) {
      console.log("WebSocket already open/connecting; reusing it");
      return previous;
    }

    const SOCKET_URL = `${getWsUrl()}?roomId=${roomId}&username=${username}&clientId=${clientId}${adminParam}${creatorParam}`;
    console.log("Creating new WS connection to", SOCKET_URL);

    // Clear previous connection if it exists
    if (previous) {
      console.log("Clearing previous connection");
      previous.onclose = () => {};
      previous.onerror = () => {};
      previous.onmessage = () => {};
      previous.onopen = () => {};
      previous.close();
    }

    const ws = new WebSocket(SOCKET_URL);

    setSocket(ws);

    ws.onopen = async () => {
      console.log("Websocket onopen fired.");

      // Reset reconnection state
      onConnectionOpen();

      // Start NTP heartbeat
      startHeartbeat();

      // A reconnect (or bfcache restore) must catch up with the room: if the
      // session was already running, resume the synchronized playback state.
      if (useGlobalStore.getState().hasUserStartedSystem) {
        sendWSRequest({
          ws,
          request: { type: ClientActionEnum.enum.SYNC },
        });
      }

      // Skip IP geolocation in demo mode (no internet)
      if (!IS_DEMO_MODE) {
        try {
          const location = await getUserLocation();

          sendWSRequest({
            ws,
            request: {
              type: ClientActionEnum.enum.SEND_IP,
              location,
            },
          });
        } catch (e) {
          console.error("Failed to geolocate IP", e);
        }
      }
    };

    // This onclose event will only fire on unwanted websocket disconnects:
    // - Network chnage
    // - Server restart
    // So we should try to reconnect.
    ws.onclose = () => {
      // A superseded socket closing must not trigger reconnection over the
      // healthy replacement socket.
      if (useGlobalStore.getState().socket !== ws) return;

      console.log("Websocket closed unexpectedly");
      // Stop NTP heartbeat
      stopHeartbeat();

      // Clear NTP measurements on new connection to avoid stale data
      useGlobalStore.getState().onConnectionReset();

      // Schedule reconnection with exponential backoff
      scheduleReconnection();
    };

    const context = { ws, markNTPResponseReceived };
    ws.onmessage = (msg) => {
      // Update last message received time for connection health
      useGlobalStore.setState({ lastMessageReceivedTime: Date.now() });

      try {
        const response = WSResponseSchema.parse(JSON.parse(msg.data));
        dispatchWSResponse({ response, context });
      } catch (error) {
        // One malformed/unexpected message must not break the message loop.
        console.error("Failed to process WebSocket message:", error);
      }
    };

    return ws;
  };

  // Once room has been loaded and we have clientId, connect to the websocket
  useEffect(() => {
    // Only run this effect once after room is loaded and clientId is available
    if (isLoadingRoom || !roomId || !username || !clientId) return;

    // Don't create a new connection if we already have one
    const existingSocket = useGlobalStore.getState().socket;
    if (existingSocket && existingSocket.readyState === WebSocket.OPEN) {
      return;
    }

    const ws = createConnection();

    // Handle bfcache restoration (iOS Safari) — WebSocket is killed on freeze
    // but the page is restored without re-running effects
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        console.log("Page restored from bfcache, reconnecting WebSocket");
        createConnection();
      }
    };
    window.addEventListener("pageshow", handlePageShow);

    // Wake events are event-driven, so they work even when the tab's timers are
    // throttled in the background: reconnect promptly after network changes or
    // when the user returns, instead of waiting on a throttled backoff timer.
    const handleOnline = () => {
      reconnectNow();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      reconnectNow();
      // If the connection survived being backgrounded, resume the NTP cadence
      // promptly so the clock offset is fresh again
      const currentSocket = useGlobalStore.getState().socket;
      if (currentSocket && currentSocket.readyState === WebSocket.OPEN) {
        startHeartbeat();
      }
    };
    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      // Runs on unmount and dependency change
      console.log("Running cleanup for WebSocket connection");

      window.removeEventListener("pageshow", handlePageShow);
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisibilityChange);

      // Clean up reconnection state
      cleanupReconnection();

      // Close the current socket (the one from mount may have been replaced by
      // a reconnect) and make sure its close doesn't schedule another retry.
      const currentSocket = useGlobalStore.getState().socket;
      if (currentSocket) {
        currentSocket.onclose = () => {
          console.log("Websocket closed by cleanup");
        };
        currentSocket.onerror = () => {};
        currentSocket.onmessage = () => {};
        currentSocket.onopen = () => {};
        currentSocket.close();
      }
      if (ws && ws !== currentSocket) {
        ws.onclose = () => {};
        ws.close();
      }

      // Stop NTP heartbeat
      stopHeartbeat();
    };
    // Not including socket in the dependency array because it will trigger the close when it's set
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoadingRoom, roomId, username, clientId]);

  return null; // This is a non-visual component
};
