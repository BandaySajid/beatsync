import { z } from "zod";
import { AudioSourceSchema } from "./basic";
import { TrackSchema } from "./provider";
import { ClientDataSchema } from "./WSBroadcast";

// Legacy upload schema (deprecated)
export const UploadAudioSchema = z.object({
  name: z.string(),
  audioData: z.string(), // base64 encoded audio data
  roomId: z.string(),
});
export type UploadAudioType = z.infer<typeof UploadAudioSchema>;

// R2 Upload URL Request
export const GetUploadUrlSchema = z.object({
  roomId: z.string(),
  fileName: z.string(),
  contentType: z
    .string()
    .refine(
      (type) => type.startsWith("audio/") || type === "video/webm",
      "Content type must be an audio mime type or video/webm"
    ),
});
export type GetUploadUrlType = z.infer<typeof GetUploadUrlSchema>;

// R2 Upload URL Response - simplified to only essential fields
export const UploadUrlResponseSchema = z.object({
  uploadUrl: z.string().url(),
  publicUrl: z.string().url(),
});
export type UploadUrlResponseType = z.infer<typeof UploadUrlResponseSchema>;

// Upload Complete Request - simplified to only essential fields
export const UploadCompleteSchema = z.object({
  roomId: z.string(),
  originalName: z.string(),
  publicUrl: z.string().url(),
});
export type UploadCompleteType = z.infer<typeof UploadCompleteSchema>;

// Upload Complete Response
export const UploadCompleteResponseSchema = z.object({
  success: z.boolean(),
});
export type UploadCompleteResponseType = z.infer<
  typeof UploadCompleteResponseSchema
>;

// Audio fetch request (unchanged)
export const GetAudioSchema = z.object({
  id: z.string(),
});
export type GetAudioType = z.infer<typeof GetAudioSchema>;

// Default audio fetch response
export const GetDefaultAudioSchema = z.array(AudioSourceSchema);
export type GetDefaultAudioType = z.infer<typeof GetDefaultAudioSchema>;

export const RoomSchema = z.object({
  roomId: z.string(),
  clientCount: z.number(),
  audioSourceCount: z.number(),
  hasSpatialAudio: z.boolean(),
});
export type RoomType = z.infer<typeof RoomSchema>;

export const GetActiveRoomsSchema = z.number();
export type GetActiveRoomsType = z.infer<typeof GetActiveRoomsSchema>;

export const DiscoveryRoomSchema = z.object({
  roomId: z.string(),
  clients: z.array(ClientDataSchema),
  audioSources: z.array(AudioSourceSchema),
  playbackState: z.object({
    type: z.enum(["playing", "paused"]),
    audioSource: z.string(), // URL of the audio source
  }),
});
export type DiscoveryRoomType = z.infer<typeof DiscoveryRoomSchema>;

export const DiscoverRoomsSchema = z.array(DiscoveryRoomSchema);
export type DiscoverRoomsType = z.infer<typeof DiscoverRoomsSchema>;

// Browsing YouTube Music: moods & genres -> curated playlists -> songs
export const MoodCategorySchema = z.object({
  title: z.string(),
  params: z.string(), // Opaque YouTube Music browse params for the category page
});
export type MoodCategoryType = z.infer<typeof MoodCategorySchema>;

// Grouped as on YouTube Music: "Moods & moments", "Genres"
export const GetMoodsResponseSchema = z.object({
  sections: z.array(z.object({ title: z.string(), categories: z.array(MoodCategorySchema) })),
});
export type GetMoodsResponseType = z.infer<typeof GetMoodsResponseSchema>;

export const BrowsePlaylistCardSchema = z.object({
  id: z.string(), // Playlist ID, as used in ?list=
  title: z.string(),
  subtitle: z.string(),
  image: z.string().optional(),
});
export type BrowsePlaylistCardType = z.infer<typeof BrowsePlaylistCardSchema>;

export const GetMoodPlaylistsResponseSchema = z.object({
  sections: z.array(z.object({ title: z.string(), playlists: z.array(BrowsePlaylistCardSchema) })),
});
export type GetMoodPlaylistsResponseType = z.infer<typeof GetMoodPlaylistsResponseSchema>;

export const GetBrowsePlaylistResponseSchema = z.object({ name: z.string(), tracks: z.array(TrackSchema) });
export type GetBrowsePlaylistResponseType = z.infer<typeof GetBrowsePlaylistResponseSchema>;
