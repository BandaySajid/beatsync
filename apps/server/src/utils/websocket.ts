import type { Server } from "bun";

export interface WSData {
  roomId: string;
  clientId: string;
  clientSecret: string; // Proves ownership of clientId; never sent to other clients
  username: string;
  isAdmin: boolean;
  isCreator: boolean;
}

export type BunServer = Server<WSData>;
