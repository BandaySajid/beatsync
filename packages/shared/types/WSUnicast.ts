// 1:1 Private WS Responses
import { z } from "zod";
import { ScheduledActionSchema, ServerActionEnum } from "./WSBroadcast";
import { SearchResponseSchema, TrackSchema } from "./provider";

const NTPResponseMessageSchema = z.object({
  type: z.literal(ServerActionEnum.enum.NTP_RESPONSE),
  t0: z.number(), // Client send timestamp (echoed back)
  t1: z.number(), // Server receive timestamp
  t2: z.number(), // Server send timestamp
  clientRTT: z.number().optional(), // Client's current RTT estimate in ms
  probeGroupId: z.number(), // Coded probes (Huygens): echoed from request
  probeGroupIndex: z.union([z.literal(0), z.literal(1)]), // Coded probes: echoed from request
});
export type NTPResponseMessageType = z.infer<typeof NTPResponseMessageSchema>;

export const MusicSearchResponseSchema = z.object({
  type: z.literal(ServerActionEnum.enum.SEARCH_RESPONSE),
  query: z.string(), // Added to prevent race conditions
  response: SearchResponseSchema,
});
export type MusicSearchResponseType = z.infer<typeof MusicSearchResponseSchema>;

export const PlaylistImportResponseSchema = z.object({
  type: z.literal(ServerActionEnum.enum.PLAYLIST_IMPORT_RESPONSE),
  url: z.string(), // The requested playlist URL, to match the response to the request
  response: z.discriminatedUnion("type", [
    z.object({ type: z.literal("success"), name: z.string(), tracks: z.array(TrackSchema) }),
    z.object({ type: z.literal("error"), message: z.string() }),
  ]),
});
export type PlaylistImportResponseType = z.infer<typeof PlaylistImportResponseSchema>;

const RoomInviteSchema = z.object({
  type: z.literal(ServerActionEnum.enum.ROOM_INVITE),
  inviteToken: z.string(),
});

// Liveness probe sent to clients that have been silent (e.g. backgrounded tabs
// with throttled timers). Clients reply with a LIVENESS_PONG request.
const LivenessPingMessageSchema = z.object({
  type: z.literal(ServerActionEnum.enum.LIVENESS_PING),
});

export const WSUnicastSchema = z.discriminatedUnion("type", [
  NTPResponseMessageSchema,
  ScheduledActionSchema,
  MusicSearchResponseSchema,
  LivenessPingMessageSchema,
  PlaylistImportResponseSchema,
  RoomInviteSchema,
]);
export type WSUnicastType = z.infer<typeof WSUnicastSchema>;
