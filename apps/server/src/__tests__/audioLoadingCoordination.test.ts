// Tests the audio loading state machine in RoomManager: the flow from play request → LOAD_AUDIO_SOURCE broadcast →
// clients reporting loaded → synchronized SCHEDULED_ACTION play. Covers happy path, timeouts, client disconnects
// mid-load, double-initiation, track removal during loading, and the zero-client guard.

import type { WSBroadcastType } from "@beatsync/shared";
import type { PlayActionType } from "@beatsync/shared/types/WSRequest";
import type { ServerWebSocket } from "bun";
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import sinon from "sinon";
import { mockR2 } from "@/__tests__/mocks/r2";
import { createMockServer, createMockWs } from "@/__tests__/mocks/websocket";
import { RoomManager } from "@/managers/RoomManager";
import type { BunServer, WSData } from "@/utils/websocket";

let broadcastMessages: { server: BunServer; roomId: string; message: WSBroadcastType }[] = [];

mockR2();

void mock.module("@/utils/responses", () => ({
  sendBroadcast: mock(
    ({ server, roomId, message }: { server: BunServer; roomId: string; message: WSBroadcastType }) => {
      broadcastMessages.push({ server, roomId, message });
    }
  ),
  sendUnicast: mock(() => {
    /* noop */
  }),
  corsHeaders: {},
  jsonResponse: mock(() => new Response()),
  errorResponse: mock(() => new Response()),
}));

const ROOM_ID = "test-room";
const AUDIO_URL = "https://example.com/song.mp3";

function createPlayAction(
  opts: { audioSource?: string; trackTimeSeconds?: number; sourceLoaded?: boolean } = {}
): PlayActionType {
  return {
    type: "PLAY",
    audioSource: opts.audioSource ?? AUDIO_URL,
    trackTimeSeconds: opts.trackTimeSeconds ?? 0,
    // Most tests exercise the "cached buffer" path so the initiator is
    // pre-resolved; dedicated tests opt out to cover the download path.
    sourceLoaded: opts.sourceLoaded ?? true,
  };
}

function createRoomWithAudio(): RoomManager {
  const room = new RoomManager(ROOM_ID);
  room.addAudioSource({ url: AUDIO_URL });
  return room;
}

function addClientsToRoom(room: RoomManager, count: number): ServerWebSocket<WSData>[] {
  const sockets: ServerWebSocket<WSData>[] = [];
  for (let i = 1; i <= count; i++) {
    const ws = createMockWs({ clientId: `client-${i}` });
    room.addClient(ws);
    sockets.push(ws);
  }
  return sockets;
}

function getScheduledActionBroadcasts() {
  return broadcastMessages.filter((msg) => msg.message.type === "SCHEDULED_ACTION");
}

function getLoadAudioBroadcasts() {
  return broadcastMessages.filter(
    (msg) => msg.message.type === "ROOM_EVENT" && msg.message.event.type === "LOAD_AUDIO_SOURCE"
  );
}

describe("Audio Loading Coordination", () => {
  let room: RoomManager;
  let server: BunServer;

  beforeEach(() => {
    broadcastMessages = [];
    room = createRoomWithAudio();
    server = createMockServer();
  });

  afterEach(() => {
    // Clear any pending timeouts from the room
    room.clearAudioLoadingState();
  });

  describe("initiateAudioSourceLoad", () => {
    it("should broadcast LOAD_AUDIO_SOURCE to all clients", () => {
      addClientsToRoom(room, 4);

      room.initiateAudioSourceLoad(createPlayAction(), "client-1", server);

      const loadBroadcasts = getLoadAudioBroadcasts();
      expect(loadBroadcasts).toHaveLength(1);

      const msg = loadBroadcasts[0].message;
      if (msg.type !== "ROOM_EVENT" || msg.event.type !== "LOAD_AUDIO_SOURCE") {
        throw new Error("Expected LOAD_AUDIO_SOURCE");
      }
      expect(msg.event.audioSourceToPlay.url).toBe(AUDIO_URL);
    });

    it("should bail when audio source does not exist in room", () => {
      addClientsToRoom(room, 1);

      room.initiateAudioSourceLoad(
        createPlayAction({ audioSource: "https://nonexistent.com/nope.mp3" }),
        "client-1",
        server
      );

      // No broadcasts should be sent
      expect(broadcastMessages).toHaveLength(0);
    });

    it("should pre-mark the initiator only when the client already has the buffer", () => {
      addClientsToRoom(room, 4);

      room.initiateAudioSourceLoad(createPlayAction({ sourceLoaded: true }), "client-1", server);
      broadcastMessages = [];

      // Initiator claimed a cached buffer, so only the other 3 need to report
      room.processClientLoadedAudioSource("client-2", server);
      room.processClientLoadedAudioSource("client-3", server);
      expect(getScheduledActionBroadcasts()).toHaveLength(0);

      room.processClientLoadedAudioSource("client-4", server);

      const scheduled = getScheduledActionBroadcasts();
      expect(scheduled).toHaveLength(1);
    });

    it("should wait for an initiator that has not loaded the source yet", () => {
      addClientsToRoom(room, 2);

      // No sourceLoaded flag: the initiator still has to download it.
      room.initiateAudioSourceLoad(createPlayAction({ sourceLoaded: false }), "client-1", server);
      broadcastMessages = [];

      room.processClientLoadedAudioSource("client-2", server);
      expect(getScheduledActionBroadcasts()).toHaveLength(0);

      room.processClientLoadedAudioSource("client-1", server);
      expect(getScheduledActionBroadcasts()).toHaveLength(1);
    });

    it("should clear previous pending state when called twice", () => {
      addClientsToRoom(room, 4);

      // First initiation
      room.initiateAudioSourceLoad(createPlayAction(), "client-1", server);

      // Second initiation should replace the first
      room.addAudioSource({ url: "https://example.com/song2.mp3" });
      room.initiateAudioSourceLoad(
        createPlayAction({ audioSource: "https://example.com/song2.mp3" }),
        "client-1",
        server
      );

      // Report all clients loaded for the second action
      room.processClientLoadedAudioSource("client-2", server);
      room.processClientLoadedAudioSource("client-3", server);
      room.processClientLoadedAudioSource("client-4", server);

      const scheduled = getScheduledActionBroadcasts();
      expect(scheduled).toHaveLength(1);

      const msg = scheduled[0].message;
      if (msg.type !== "SCHEDULED_ACTION" || msg.scheduledAction.type !== "PLAY") {
        throw new Error("Expected PLAY scheduled action");
      }
      expect(msg.scheduledAction.audioSource).toBe("https://example.com/song2.mp3");
    });
  });

  describe("processClientLoadedAudioSource", () => {
    it("should trigger play when all clients have loaded", () => {
      addClientsToRoom(room, 4);

      room.initiateAudioSourceLoad(createPlayAction(), "client-1", server);
      broadcastMessages = [];

      room.processClientLoadedAudioSource("client-2", server);
      room.processClientLoadedAudioSource("client-3", server);
      expect(getScheduledActionBroadcasts()).toHaveLength(0);

      room.processClientLoadedAudioSource("client-4", server);
      // Now all 4 loaded - should trigger
      const scheduled = getScheduledActionBroadcasts();
      expect(scheduled).toHaveLength(1);
    });

    it("should be idempotent for the same client reporting multiple times", () => {
      addClientsToRoom(room, 4);

      room.initiateAudioSourceLoad(createPlayAction(), "client-1", server);
      broadcastMessages = [];

      room.processClientLoadedAudioSource("client-2", server);
      room.processClientLoadedAudioSource("client-3", server);
      room.processClientLoadedAudioSource("client-4", server);

      // client-4 reports loaded again multiple times - should not re-trigger
      room.processClientLoadedAudioSource("client-4", server);
      room.processClientLoadedAudioSource("client-4", server);

      const scheduled = getScheduledActionBroadcasts();
      expect(scheduled).toHaveLength(1);
    });

    it("should ignore load reports for a different source (prefetch completing late)", () => {
      addClientsToRoom(room, 2);

      room.initiateAudioSourceLoad(createPlayAction({ sourceLoaded: false }), "client-1", server);
      broadcastMessages = [];

      // client-2 just finished prefetching some other track, not the pending one
      room.processClientLoadedAudioSource("client-2", server, "https://example.com/other.mp3");
      expect(getScheduledActionBroadcasts()).toHaveLength(0);

      room.processClientLoadedAudioSource("client-1", server, AUDIO_URL);
      room.processClientLoadedAudioSource("client-2", server, AUDIO_URL);
      expect(getScheduledActionBroadcasts()).toHaveLength(1);
    });

    it("should start playback when a failed client would otherwise block the room", () => {
      addClientsToRoom(room, 3);

      room.initiateAudioSourceLoad(createPlayAction({ sourceLoaded: false }), "client-1", server);
      broadcastMessages = [];

      room.processClientLoadedAudioSource("client-1", server, AUDIO_URL);
      room.processClientLoadedAudioSource("client-2", server, AUDIO_URL);
      expect(getScheduledActionBroadcasts()).toHaveLength(0);

      // client-3 cannot decode the track; don't hold the room for the full timeout
      room.processClientAudioLoadFailed("client-3", AUDIO_URL);
      expect(getScheduledActionBroadcasts()).toHaveLength(1);
    });

    it("should abort play when every client fails to load the source", () => {
      addClientsToRoom(room, 2);

      room.initiateAudioSourceLoad(createPlayAction({ sourceLoaded: false }), "client-1", server);
      broadcastMessages = [];

      room.processClientAudioLoadFailed("client-1", AUDIO_URL);
      room.processClientAudioLoadFailed("client-2", AUDIO_URL);

      expect(getScheduledActionBroadcasts()).toHaveLength(0);
    });
  });

  describe("executeScheduledPlay (via all clients loaded)", () => {
    it("should broadcast SCHEDULED_ACTION with PLAY and update playback state", () => {
      addClientsToRoom(room, 4);

      room.initiateAudioSourceLoad(createPlayAction({ trackTimeSeconds: 42.5 }), "client-1", server);
      broadcastMessages = [];

      room.processClientLoadedAudioSource("client-2", server);
      room.processClientLoadedAudioSource("client-3", server);
      room.processClientLoadedAudioSource("client-4", server);

      const scheduled = getScheduledActionBroadcasts();
      expect(scheduled).toHaveLength(1);

      const msg = scheduled[0].message;
      if (msg.type !== "SCHEDULED_ACTION" || msg.scheduledAction.type !== "PLAY") {
        throw new Error("Expected PLAY scheduled action");
      }
      expect(msg.scheduledAction.audioSource).toBe(AUDIO_URL);
      expect(msg.scheduledAction.trackTimeSeconds).toBe(42.5);
      expect(msg.serverTimeToExecute).toBeGreaterThan(0);

      // Playback state should be updated
      const state = room.getPlaybackState();
      expect(state.type).toBe("playing");
      expect(state.audioSource).toBe(AUDIO_URL);
      expect(state.trackPositionSeconds).toBe(42.5);
    });

    it("should not broadcast if the audio source was removed between initiation and execution", () => {
      addClientsToRoom(room, 4);

      room.initiateAudioSourceLoad(createPlayAction(), "client-1", server);
      broadcastMessages = [];

      // Remove the audio source mid-load
      room.removeAudioSources([AUDIO_URL]);

      // All remaining clients report loaded - triggers executeScheduledPlay
      room.processClientLoadedAudioSource("client-2", server);
      room.processClientLoadedAudioSource("client-3", server);
      room.processClientLoadedAudioSource("client-4", server);

      // Should not have broadcast a SCHEDULED_ACTION since the track no longer exists
      const scheduled = getScheduledActionBroadcasts();
      expect(scheduled).toHaveLength(0);

      // Playback state should NOT be updated to playing
      expect(room.getPlaybackState().type).toBe("paused");
    });
  });

  describe("timeout behavior", () => {
    let clock: sinon.SinonFakeTimers;

    beforeEach(() => {
      // Use sinon (not Bun's vi) so fake timers compose with the liveness
      // suite, which also drives sinon's clock in the same process.
      clock = sinon.useFakeTimers();
    });

    afterEach(() => {
      clock.restore();
    });

    it("should execute play after timeout even if not all clients loaded", () => {
      addClientsToRoom(room, 4);

      room.initiateAudioSourceLoad(createPlayAction(), "client-1", server);
      broadcastMessages = [];

      // Only client-2 and client-3 load, client-4 never responds
      room.processClientLoadedAudioSource("client-2", server);
      room.processClientLoadedAudioSource("client-3", server);
      expect(getScheduledActionBroadcasts()).toHaveLength(0);

      // Advance past the timeout
      clock.tick(RoomManager.AUDIO_LOAD_TIMEOUT_MS);

      const scheduled = getScheduledActionBroadcasts();
      expect(scheduled).toHaveLength(1);
    });

    it("should not double-fire if all clients load before timeout", () => {
      addClientsToRoom(room, 4);

      room.initiateAudioSourceLoad(createPlayAction(), "client-1", server);
      broadcastMessages = [];

      // All clients load immediately
      room.processClientLoadedAudioSource("client-2", server);
      room.processClientLoadedAudioSource("client-3", server);
      room.processClientLoadedAudioSource("client-4", server);
      expect(getScheduledActionBroadcasts()).toHaveLength(1);

      // Advance past the timeout window - should not fire again
      clock.tick(RoomManager.AUDIO_LOAD_TIMEOUT_MS);

      // Should still only have 1 scheduled action (timeout was cleared)
      expect(getScheduledActionBroadcasts()).toHaveLength(1);
    });
  });

  describe("client disconnect during loading", () => {
    it("should trigger play when a disconnecting client makes remaining clients all-loaded", () => {
      addClientsToRoom(room, 4);

      room.initiateAudioSourceLoad(createPlayAction(), "client-1", server);
      broadcastMessages = [];

      // client-2 and client-3 load
      room.processClientLoadedAudioSource("client-2", server);
      room.processClientLoadedAudioSource("client-3", server);
      expect(getScheduledActionBroadcasts()).toHaveLength(0);

      // client-4 disconnects before loading - remaining 3 are all loaded
      room.removeClient("client-4");

      const scheduled = getScheduledActionBroadcasts();
      expect(scheduled).toHaveLength(1);
    });

    it("should not trigger play if disconnecting client leaves others still unloaded", () => {
      addClientsToRoom(room, 5);

      room.initiateAudioSourceLoad(createPlayAction(), "client-1", server);
      broadcastMessages = [];

      // client-2 loads, client-3/4/5 haven't
      room.processClientLoadedAudioSource("client-2", server);

      // client-3 disconnects - but client-4 and client-5 still haven't loaded
      room.removeClient("client-3");

      expect(getScheduledActionBroadcasts()).toHaveLength(0);
    });

    it("should not trigger play if all clients disconnect during loading", () => {
      addClientsToRoom(room, 4);

      room.initiateAudioSourceLoad(createPlayAction(), "client-1", server);
      broadcastMessages = [];

      // All clients disconnect
      room.removeClient("client-1");
      room.removeClient("client-2");
      room.removeClient("client-3");
      room.removeClient("client-4");

      // Zero clients - should not trigger play
      expect(getScheduledActionBroadcasts()).toHaveLength(0);
    });
  });
});
