import { IS_DEMO_MODE } from "@/demo";
import { suggestionsMessage } from "@/lib/suggestions";
import { globalManager } from "@/managers";
import { sendBroadcast, sendToClient, sendUnicast } from "@/utils/responses";
import type { BunServer, WSData } from "@/utils/websocket";
import { dispatchMessage } from "@/websocket/dispatch";
import type { WSBroadcastType } from "@beatsync/shared";
import { epochNow, WSRequestSchema } from "@beatsync/shared";
import type { ServerWebSocket } from "bun";

const createClientUpdate = (roomId: string) => {
  const room = globalManager.getRoom(roomId);
  const message: WSBroadcastType = {
    type: "ROOM_EVENT",
    event: {
      type: "CLIENT_CHANGE",
      clients: room ? room.getClients() : [],
    },
  };
  return message;
};

function debouncedClientChangeBroadcast(server: BunServer, roomId: string): void {
  const room = globalManager.getRoom(roomId);
  if (!room) return;
  room.scheduleClientChangeBroadcast(() => {
    sendBroadcast({ server, roomId, message: createClientUpdate(roomId) });
  });
}

function debouncedDemoUserCountBroadcast(server: BunServer, roomId: string): void {
  const room = globalManager.getRoom(roomId);
  if (!room) return;
  room.scheduleClientChangeBroadcast(() => {
    sendBroadcast({
      server,
      roomId,
      message: { type: "DEMO_USER_COUNT", count: room.getNumClients() },
    });
  });
}

export const handleOpen = (ws: ServerWebSocket<WSData>, server: BunServer) => {
  console.log(`WebSocket connection opened for user ${ws.data.username} in room ${ws.data.roomId}`);

  const { roomId } = ws.data;
  ws.subscribe(roomId);

  const isNewRoom = !globalManager.getRoom(roomId);
  const room = globalManager.getOrCreateRoom(roomId);
  // Only the connection that creates a room decides whether it is private.
  if (isNewRoom && ws.data.privateRoom) room.setPrivate();
  room.addClient(ws);

  const { audioSources, globalVolume, lowPassFreq } = room.getState();
  const now = epochNow();

  // Always send the current queue, including an empty one. A reconnect can land
  // in a room that was cleaned up or restarted; without the empty update the
  // client would keep showing and playing its stale local queue.
  console.log(
    audioSources.length > 0
      ? `Sending ${audioSources.length} audio source(s) to newly joined client ${ws.data.username}`
      : `Sending empty audio source list to newly joined client ${ws.data.username}`
  );

  sendToClient({
    ws,
    message: {
      type: "ROOM_EVENT",
      event: {
        type: "SET_AUDIO_SOURCES",
        sources: audioSources,
        currentAudioSource: room.getPlaybackState().audioSource || undefined,
      },
    },
  });

  sendToClient({
    ws,
    message: {
      type: "ROOM_EVENT",
      event: {
        type: "SET_PLAYBACK_CONTROLS",
        permissions: room.getPlaybackControlsPermissions(),
      },
    },
  });

  sendUnicast({
    ws,
    message: {
      type: "SCHEDULED_ACTION",
      serverTimeToExecute: now,
      scheduledAction: {
        type: "GLOBAL_VOLUME_CONFIG",
        volume: globalVolume,
        rampTime: 0.1,
      },
    },
  });

  sendUnicast({
    ws,
    message: {
      type: "SCHEDULED_ACTION",
      serverTimeToExecute: now,
      scheduledAction: {
        type: "METRONOME_CONFIG",
        enabled: room.getIsMetronomeEnabled(),
      },
    },
  });

  sendUnicast({
    ws,
    message: {
      type: "SCHEDULED_ACTION",
      serverTimeToExecute: now,
      scheduledAction: {
        type: "LOW_PASS_CONFIG",
        freq: lowPassFreq,
        rampTime: 0.05,
      },
    },
  });

  const messages = room.getFullChatHistory();
  if (messages.length > 0) {
    sendToClient({
      ws,
      message: {
        type: "ROOM_EVENT",
        event: {
          type: "CHAT_UPDATE",
          messages: messages,
          isFullSync: true,
          newestId: room.getNewestChatId(),
        },
      },
    });
  }

  if (IS_DEMO_MODE) {
    // In demo mode, only send this client's own entry (no point sending thousands of stale entries)
    const self = globalManager.getRoom(roomId)?.getClient(ws.data.clientId);
    sendToClient({
      ws,
      message: {
        type: "ROOM_EVENT",
        event: {
          type: "CLIENT_CHANGE",
          clients: self ? [self] : [],
        },
      },
    });
    // Broadcast updated user count to all clients
    debouncedDemoUserCountBroadcast(server, roomId);
    // Send current audio ready count to the newly joined client
    sendToClient({
      ws,
      message: { type: "DEMO_AUDIO_READY_COUNT", count: room.getDemoAudioReadyCount() },
    });
  } else {
    // Suggestions are only broadcast when they change, so a late joiner needs the current set.
    sendToClient({ ws, message: suggestionsMessage(room) });
    // Unicast full client list to the joining client immediately
    sendToClient({ ws, message: createClientUpdate(roomId) });
    // Broadcast to others: debounced
    debouncedClientChangeBroadcast(server, roomId);
  }
};

export const handleMessage = async (ws: ServerWebSocket<WSData>, message: string | Buffer, server: BunServer) => {
  const t1 = epochNow(); // Always capture immediately on receive
  const { roomId, username } = ws.data;

  try {
    const parsedData: unknown = JSON.parse(message.toString());

    // Any inbound message proves the connection is alive. Record liveness once,
    // here at the single entry point for client messages — this covers the NTP
    // fast path below and LIVENESS_PONGs alike.
    const room = globalManager.getRoom(roomId);
    room?.markClientSeen(ws.data.clientId);

    // Fast path: NTP requests skip Zod validation and dispatch overhead.
    // t1 is already captured above; t2 is captured right before ws.send()
    // to minimize server processing time contaminating the timestamps.
    if ((parsedData as { type?: string })?.type === "NTP_REQUEST") {
      const msg = parsedData as {
        t0: number;
        clientRTT?: number;
        clientCompensationMs?: number;
        clientNudgeMs?: number;
        probeGroupId: number;
        probeGroupIndex: number;
      };

      if (room) {
        room.processNTPRequestFrom({
          clientId: ws.data.clientId,
          clientRTT: msg.clientRTT,
          clientCompensationMs: msg.clientCompensationMs,
          clientNudgeMs: msg.clientNudgeMs,
        });
      }

      // Capture t2 as late as possible — right before send
      const response = JSON.stringify({
        type: "NTP_RESPONSE",
        t0: msg.t0,
        t1,
        t2: epochNow(),
        probeGroupId: msg.probeGroupId,
        probeGroupIndex: msg.probeGroupIndex,
      });
      ws.send(response);
      return;
    }

    const parsedMessage = WSRequestSchema.parse(parsedData);
    console.log(`[Room: ${roomId}] | User: ${username} | Message: ${JSON.stringify(parsedMessage)}`);

    // Delegate to type-safe dispatcher
    await dispatchMessage({ ws, message: parsedMessage, server });
  } catch (error) {
    console.error("Invalid message format:", error);
    ws.send(JSON.stringify({ type: "ERROR", message: "Invalid message format" }));
  }
};

export const handleClose = (ws: ServerWebSocket<WSData>, server: BunServer) => {
  try {
    console.log(`WebSocket connection closed for user ${ws.data.username} in room ${ws.data.roomId}`);

    const { roomId, clientId } = ws.data;
    const room = globalManager.getRoom(roomId);

    if (room) {
      room.removeClient(clientId);

      // Schedule cleanup for rooms with no active connections
      if (!room.hasActiveConnections()) {
        room.stopSpatialAudio();
        room.clearClientChangeBroadcast();
        globalManager.scheduleRoomCleanup(roomId);
      }
    }

    ws.unsubscribe(roomId);

    // Only broadcast if there are still clients to receive it
    if (room?.hasActiveConnections()) {
      if (IS_DEMO_MODE) {
        debouncedDemoUserCountBroadcast(server, roomId);
      } else {
        debouncedClientChangeBroadcast(server, roomId);
      }
    }
  } catch (error) {
    console.error(`Error handling WebSocket close for ${ws.data?.username}:`, error);
  }
};
