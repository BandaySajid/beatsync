import { IS_DEMO_MODE } from "@/demo";
import { YOUTUBE_MANAGER, YoutubeManager } from "@/managers/YoutubeManager";
import { errorResponse, jsonResponse } from "@/utils/responses";

// Category params are opaque base64 tokens from YouTube Music.
const MOOD_PARAMS_PATTERN = /^[A-Za-z0-9_\-=%]{1,256}$/;
const MAX_ARTIST_NAME_LENGTH = 100;

/**
 * YouTube Music browsing: GET /browse/moods, /browse/mood?params=, /browse/playlist?id=,
 * /browse/artist?id= (or ?name=), /browse/album?id=, /browse/radio?videoId=
 */
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

      case "/browse/artist": {
        // By channel ID, or by name for songs that only carry the artist's name.
        const name = url.searchParams.get("name")?.trim().slice(0, MAX_ARTIST_NAME_LENGTH);
        const id = url.searchParams.get("id") ?? (name ? await YOUTUBE_MANAGER.findArtistId(name) : null);
        if (!id) return errorResponse("Artist not found", 404);
        if (!YoutubeManager.isArtistId(id)) return errorResponse("Invalid artist ID");
        return jsonResponse(await YOUTUBE_MANAGER.getArtist(id));
      }

      case "/browse/album": {
        const id = url.searchParams.get("id") ?? "";
        if (!YoutubeManager.isAlbumId(id)) return errorResponse("Invalid album ID");
        return jsonResponse(await YOUTUBE_MANAGER.getAlbum(id));
      }

      case "/browse/radio": {
        const videoId = url.searchParams.get("videoId") ?? "";
        if (!YoutubeManager.isVideoId(videoId)) return errorResponse("Invalid video ID");
        return jsonResponse({ tracks: await YOUTUBE_MANAGER.getRadio(videoId) });
      }

      default:
        return errorResponse("Not found", 404);
    }
  } catch (error) {
    console.error(`[Browse] ${url.pathname}${url.search} failed:`, error);
    return errorResponse("Couldn't load this from YouTube Music", 502);
  }
}
