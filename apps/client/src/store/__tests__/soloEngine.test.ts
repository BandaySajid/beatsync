import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { getClientId } from "@/lib/clientId";
import { useGlobalStore } from "@/store/global";
import { useRoomStore } from "@/store/room";
import { epochNow, type ClientDataType } from "@beatsync/shared";

// Fake <audio> engine that records what the store asks it to do.
let played: { url: string; position: number }[] = [];
let stops = 0;
let playing = false;
let position = 0;
void mock.module("@/lib/soloPlayer", () => ({
  soloPlayer: {
    setCallbacks: () => undefined,
    unlock: () => undefined,
    play: (url: string, at: number) => {
      played.push({ url, position: at });
      playing = true;
      position = at;
      return Promise.resolve(true);
    },
    pause: () => {
      playing = false;
    },
    stop: () => {
      stops++;
      playing = false;
    },
    get currentTime() {
      return position;
    },
    get isPlaying() {
      return playing;
    },
    setVolume: () => undefined,
  },
}));

const URL_A = "https://cdn.example.com/youtube/abc/Song___yt.m4a";
const client = (clientId: string) => ({ clientId, username: clientId }) as ClientDataType;

const setup = ({ solo }: { solo: boolean }) => {
  played = [];
  stops = 0;
  playing = false;
  position = 0;
  const send = mock<(data: string) => void>(() => undefined);
  useRoomStore.setState({ isSolo: solo });
  useGlobalStore.setState({
    socket: { readyState: WebSocket.OPEN, send } as unknown as WebSocket,
    audioSources: [{ source: { url: URL_A }, status: "idle" }],
    selectedAudioUrl: URL_A,
    connectedClients: [client(getClientId())],
    isPlaying: false,
    currentTime: 0,
    isInitingSystem: false,
    offsetEstimate: 0,
  });
  const sentTypes = () => send.mock.calls.map(([data]) => JSON.parse(data) as Record<string, unknown>);
  return { sentTypes };
};

describe("solo streaming engine", () => {
  beforeEach(() => {
    // The room engine downloads buffers; keep that off the network.
    spyOn(globalThis, "fetch").mockImplementation(
      (() => new Promise<Response>(() => undefined)) as unknown as typeof fetch
    );
  });

  it("plays locally right away and still tells the server (marked as loaded)", () => {
    const { sentTypes } = setup({ solo: true });

    useGlobalStore.getState().broadcastPlay(12);

    expect(played).toEqual([{ url: URL_A, position: 12 }]);
    expect(useGlobalStore.getState().isPlaying).toBe(true);
    expect(sentTypes()).toContainEqual({ type: "PLAY", trackTimeSeconds: 12, audioSource: URL_A, sourceLoaded: true });
    expect(globalThis.fetch).not.toHaveBeenCalled(); // no full download in solo
  });

  it("ignores the server's echo of its own play, but follows a different position", () => {
    setup({ solo: true });
    useGlobalStore.getState().broadcastPlay(12);

    const echo = { audioSource: URL_A, trackTimeSeconds: 12, targetServerTime: epochNow() + 100 };
    void useGlobalStore.getState().schedulePlay(echo);
    expect(played).toHaveLength(1);

    void useGlobalStore.getState().schedulePlay({ ...echo, trackTimeSeconds: 60 });
    expect(played.at(-1)).toEqual({ url: URL_A, position: 60 });
  });

  it("hands the song to the synced engine when a friend joins", () => {
    const { sentTypes } = setup({ solo: true });
    useGlobalStore.getState().broadcastPlay(0);
    position = 30;

    useGlobalStore.getState().setConnectedClients([client(getClientId()), client("friend")]);

    expect(stops).toBe(1);
    expect(sentTypes().at(-1)).toMatchObject({ type: "PLAY", trackTimeSeconds: 30, audioSource: URL_A });
    expect(sentTypes().at(-1)?.sourceLoaded).toBe(false); // the room engine downloads it first
  });

  it("leaves room playback on the synced engine", () => {
    setup({ solo: false });
    useGlobalStore.getState().broadcastPlay(5);
    expect(played).toHaveLength(0);
  });
});
