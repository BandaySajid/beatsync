import { IS_DEMO_MODE } from "@/demo";
import { YOUTUBE_MANAGER, YoutubeManager } from "@/managers/YoutubeManager";
import { sendUnicast } from "@/utils/responses";
import type { HandlerFunction } from "@/websocket/types";
import type { ExtractWSRequestFrom, PlaylistImportResponseType } from "@beatsync/shared";

/** Read a YouTube playlist for the requesting client to save in its on-device library. */
export const handleImportPlaylist: HandlerFunction<ExtractWSRequestFrom["IMPORT_PLAYLIST"]> = async ({
  ws,
  message,
}) => {
  if (IS_DEMO_MODE) return;
  const reply = (response: PlaylistImportResponseType["response"]) =>
    sendUnicast({ ws, message: { type: "PLAYLIST_IMPORT_RESPONSE", url: message.url, response } });

  const playlistId = YoutubeManager.getPlaylistId(message.url);
  if (!playlistId) {
    reply({ type: "error", message: "That isn't a YouTube or YouTube Music playlist link" });
    return;
  }

  try {
    const { name, tracks } = await YOUTUBE_MANAGER.getPlaylist(playlistId);
    if (tracks.length === 0) {
      reply({ type: "error", message: "That playlist is empty or private" });
      return;
    }
    reply({ type: "success", name, tracks });
  } catch (error) {
    console.warn(`[YouTube] Playlist import failed for ${playlistId}:`, error);
    const text = error instanceof Error ? error.message : "";
    reply({
      type: "error",
      message: text.startsWith("YouTube Mixes") ? text : "Couldn't read that playlist (is it private?)",
    });
  }
};
