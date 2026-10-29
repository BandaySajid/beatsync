"use client";
import { generateName } from "@/lib/randomNames";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useGlobalStore } from "@/store/global";
import { useRoomStore } from "@/store/room";
import { motion } from "motion/react";
import { useEffect, useLayoutEffect } from "react";
import { IS_DEMO_MODE } from "@/lib/demo";
import { Dashboard } from "./dashboard/Dashboard";
import { DemoDashboard } from "./dashboard/DemoDashboard";
import { ResumeAudioOverlay } from "./room/ResumeAudioOverlay";
import { WebSocketManager } from "./room/WebSocketManager";

interface NewSyncerProps {
  roomId: string;
}

// Main component has been refactored into smaller components
export const NewSyncer = ({ roomId }: NewSyncerProps) => {
  const setUsername = useRoomStore((state) => state.setUsername);
  const setRoomId = useRoomStore((state) => state.setRoomId);
  const username = useRoomStore((state) => state.username);
  const hydratePersistedState = useGlobalStore((state) => state.hydratePersistedState);

  // Restore the same tab's Start System/NTP state before the WebSocket effect
  // runs, without putting sessionStorage reads in the initial render (which
  // would break Next.js hydration).
  useLayoutEffect(() => {
    hydratePersistedState();
  }, [hydratePersistedState]);

  // Update document title based on playback state
  useDocumentTitle();

  // Keep the same display name across refreshes; clientId already persists, so
  // the server restores the same room member either way.
  useEffect(() => {
    setRoomId(roomId);
    if (!username) {
      let storedName: string | null = null;
      try {
        storedName = localStorage.getItem("beatsync:username");
      } catch {
        // Storage unavailable; fall back to a generated name.
      }
      setUsername(storedName || generateName());
    }
  }, [setUsername, username, roomId, setRoomId]);

  useEffect(() => {
    if (!username) return;
    try {
      localStorage.setItem("beatsync:username", username);
    } catch {
      // Best-effort only.
    }
  }, [username]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
      {/* WebSocket connection manager (non-visual component) */}
      <WebSocketManager roomId={roomId} username={username} />
      <ResumeAudioOverlay />

      {/* Spatial audio background effects */}
      {/* <SpatialAudioBackground /> */}

      {IS_DEMO_MODE ? <DemoDashboard roomId={roomId} /> : <Dashboard roomId={roomId} />}
    </motion.div>
  );
};
