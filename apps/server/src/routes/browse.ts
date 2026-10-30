import { IS_DEMO_MODE } from "@/demo";
import { YOUTUBE_MANAGER, YoutubeManager } from "@/managers/YoutubeManager";
import { errorResponse, jsonResponse } from "@/utils/responses";

// Category params are opaque base64 tokens from YouTube Music.
const MOOD_PARAMS_PATTERN = /^[A-Za-z0-9_\-=%]{1,256}$/;

/** GET /browse/moods, /browse/mood?params=, /browse/playlist?id= (YouTube Music browsing). */
export async function handleBrowse(url: URL): Promise<Response> {
  if (IS_DEMO_MODE) return errorResponse("Browsing is disabled in demo mode", 403);

  try {
    switch (url.pathname) {
      case "/browse/moods":
        return jsonResponse(await YOUTUBE_MANAGER.getMoods());

      case "/browse/mood": {
        const params = url.searchParams.get("params") ?? "";
        if (!MOOD_PARAMS_PATTERN.test(params)) return errorResponse("Invalid category");
        return jsonResponse(await YOUTUBE_MANAGER.getMoodPlaylists(params));
      }

      case "/browse/playlist": {
        const id = url.searchParams.get("id") ?? "";
        if (!YoutubeManager.isPlaylistId(id)) return errorResponse("Invalid playlist ID");
        return jsonResponse(await YOUTUBE_MANAGER.getBrowsePlaylist(id));
      }

      default:
        return errorResponse("Not found", 404);
    }
  } catch (error) {
    console.error(`[Browse] ${url.pathname}${url.search} failed:`, error);
    return errorResponse("Couldn't load this from YouTube Music", 502);
  }
}
