import { beforeEach, describe, expect, it } from "bun:test";
import { useLibraryStore } from "@/store/library";
import { WS_RESPONSE_REGISTRY } from "@/websocket/registry";
import type { TrackType } from "@beatsync/shared";

const ytTrack = (id: string, title: string, artist: string) =>
  ({
    id,
    title,
    duration: 200,
    parental_warning: false,
    track_number: 1,
    performer: { name: artist, id: 0 },
    album: {
      title: "YouTube",
      id: "0",
      duration: 200,
      parental_warning: false,
      release_date_original: "",
      image: { thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, small: "", large: "" },
    },
  }) as TrackType;

describe("playlist import response", () => {
  beforeEach(() => useLibraryStore.setState({ playlists: [] }));

  it("saves the imported playlist into the on-device library", () => {
    const handle = WS_RESPONSE_REGISTRY.PLAYLIST_IMPORT_RESPONSE.handle as (data: { response: unknown }) => void;
    handle({
      response: {
        type: "PLAYLIST_IMPORT_RESPONSE",
        url: "https://www.youtube.com/playlist?list=PLabcdefghij",
        response: {
          type: "success",
          name: "Party mix",
          tracks: [ytTrack("dQw4w9WgXcQ", "Never Gonna Give You Up", "Rick Astley")],
        },
      },
    });

    expect(useLibraryStore.getState().playlists).toMatchObject([
      {
        name: "Party mix",
        tracks: [
          {
            id: "dQw4w9WgXcQ",
            title: "Never Gonna Give You Up",
            artist: "Rick Astley",
            image: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
          },
        ],
      },
    ]);
  });

  it("creates nothing when the server couldn't read the playlist", () => {
    const handle = WS_RESPONSE_REGISTRY.PLAYLIST_IMPORT_RESPONSE.handle as (data: { response: unknown }) => void;
    handle({
      response: { type: "PLAYLIST_IMPORT_RESPONSE", url: "x", response: { type: "error", message: "private" } },
    });
    expect(useLibraryStore.getState().playlists).toEqual([]);
  });
});
