import { IS_DEMO_MODE } from "@/demo";
import { MUSIC_PROVIDER_MANAGER } from "@/managers/MusicProviderManager";
import { YOUTUBE_MANAGER } from "@/managers/YoutubeManager";
import { sendUnicast } from "@/utils/responses";
import type { HandlerFunction } from "@/websocket/types";
import type { ExtractWSRequestFrom } from "@beatsync/shared";

export const handleSearchMusic: HandlerFunction<ExtractWSRequestFrom["SEARCH_MUSIC"]> = async ({ ws, message }) => {
  if (IS_DEMO_MODE) return;
  try {
    const [appleResult, ytResult] = await Promise.allSettled([
      MUSIC_PROVIDER_MANAGER.search(message.query, message.offset ?? 0),
      // Only fetch YouTube results on the first page
      message.offset === 0 || !message.offset ? YOUTUBE_MANAGER.search(message.query) : Promise.resolve([]),
    ]);

    const data = appleResult.status === "fulfilled" ? appleResult.value : null;
    const ytTracks = ytResult.status === "fulfilled" ? ytResult.value : [];

    if (data) {
      // Inject YouTube tracks at the beginning
      data.data.tracks.items = [...ytTracks, ...data.data.tracks.items];
    } else if (ytTracks.length > 0) {
      // If Apple Music failed but YouTube succeeded, return a mock response with just YouTube tracks
      const mockData = {
        data: {
          tracks: {
            limit: 50,
            offset: 0,
            total: ytTracks.length,
            items: ytTracks,
          },
        },
      };
      // Type assertion because we know it structurally matches but we can't cleanly parse it here without issues if we mutate
      sendUnicast({
        ws,
        message: {
          type: "SEARCH_RESPONSE",
          query: message.query,
          response: {
            type: "success",
            response: mockData,
          },
        },
      });
      return;
    } else {
      throw new Error("Both search providers failed");
    }

    sendUnicast({
      ws,
      message: {
        type: "SEARCH_RESPONSE",
        query: message.query,
        response: {
          type: "success",
          response: data,
        },
      },
    });
  } catch (error) {
    console.error(error);
    sendUnicast({
      ws,
      message: {
        type: "SEARCH_RESPONSE",
        query: message.query,
        response: {
          type: "error",
          message: "An error occurred while searching",
        },
      },
    });
  }
};
