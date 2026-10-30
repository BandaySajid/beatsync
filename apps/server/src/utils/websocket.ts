import type { Server } from "bun";

export interface WSData {
  roomId: string;
  clientId: string;
  clientSecret: string; // Proves ownership of clientId; never sent to other clients
  username: string;
  isAdmin: boolean;
  isCreator: boolean;
  privateRoom: boolean; // Solo session: make the room private if this connection creates it
}

export type BunServer = Server<WSData>;
