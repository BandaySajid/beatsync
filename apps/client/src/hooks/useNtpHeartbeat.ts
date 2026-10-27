import { useCallback, useEffect, useRef } from "react";
import { useGlobalStore, MAX_NTP_MEASUREMENTS } from "@/store/global";
import { NTP_CONSTANTS } from "@beatsync/shared";

interface UseNtpHeartbeatProps {
  onConnectionStale?: () => void;
}

export const useNtpHeartbeat = ({ onConnectionStale }: UseNtpHeartbeatProps) => {
  const ntpTimerRef = useRef<number | null>(null);
  const lastNtpRequestTime = useRef<number | null>(null);
  const sendProbePair = useGlobalStore((state) => state.sendProbePair);

  // Store the schedule function in a ref to allow self-referencing without
  // declaring a variable before its useCallback definition
  const scheduleRef = useRef<() => void>(() => {});

  // Schedule next NTP request
  const scheduleNextNtpRequest = useCallback(() => {
    // Cancel any existing timeout
    if (ntpTimerRef.current) {
      clearTimeout(ntpTimerRef.current);
    }

    // Determine interval based on whether we have initial measurements
    const currentMeasurements = useGlobalStore.getState().syncMeasurements;
    const interval =
      currentMeasurements.length < MAX_NTP_MEASUREMENTS
        ? NTP_CONSTANTS.INITIAL_INTERVAL_MS
        : NTP_CONSTANTS.STEADY_STATE_INTERVAL_MS;

    ntpTimerRef.current = window.setTimeout(() => {
      // Check if we have a pending request that timed out BEFORE sending another.
      // `lastNtpRequestTime` is only set when a probe is sent and cleared when a
      // response arrives, so it represents the oldest unanswered probe. (The old
      // code reset it on every send, which meant a half-open socket in steady
      // state could never be detected: a new 2.5s send always refreshed it.)
      if (lastNtpRequestTime.current && Date.now() - lastNtpRequestTime.current > NTP_CONSTANTS.RESPONSE_TIMEOUT_MS) {
        const { lastMessageReceivedTime } = useGlobalStore.getState();
        const linkIsAlive = lastMessageReceivedTime !== null && lastMessageReceivedTime >= lastNtpRequestTime.current;
        const isBackgrounded = typeof document !== "undefined" && document.visibilityState === "hidden";

        // Any server message after the probe proves the socket is alive — the
        // probe itself may just have been queued behind a saturated download.
        // A backgrounded tab also gets throttled timers, so don't judge latency
        // there; the server's liveness ping/pong covers that case.
        if (!linkIsAlive && !isBackgrounded) {
          console.error("NTP request timed out - connection may be stale");
          // Notify parent component that connection is stale
          onConnectionStale?.();
          return; // Don't send another request or schedule next
        }

        // The link is alive through other traffic (or we can't judge while
        // backgrounded). Let a fresh probe replace the stale pending one.
        lastNtpRequestTime.current = null;
      }

      // Keep the rapid cadence for initial calibration, but only the first
      // unanswered probe sets the timer. Otherwise a 2.5s send would keep
      // refreshing it and hide a dead socket forever.
      if (lastNtpRequestTime.current === null) {
        lastNtpRequestTime.current = Date.now();
      }
      try {
        sendProbePair();
      } catch (error) {
        // Socket closed between the timer firing and the send. Let onclose own
        // the reconnect instead of breaking the heartbeat chain.
        console.warn("NTP heartbeat could not send probe:", error);
        return;
      }
      scheduleRef.current(); // Schedule the next one via ref
    }, interval);
  }, [sendProbePair, onConnectionStale]);

  // Keep scheduleRef in sync with the latest callback via useEffect
  useEffect(() => {
    scheduleRef.current = scheduleNextNtpRequest;
  }, [scheduleNextNtpRequest]);

  // Start the heartbeat when socket opens
  const startHeartbeat = useCallback(() => {
    scheduleNextNtpRequest();
  }, [scheduleNextNtpRequest]);

  // Stop the heartbeat
  const stopHeartbeat = useCallback(() => {
    if (ntpTimerRef.current) {
      clearTimeout(ntpTimerRef.current);
      ntpTimerRef.current = null;
    }
    lastNtpRequestTime.current = null;
  }, []);

  // Mark that we received an NTP response
  const markNTPResponseReceived = useCallback(() => {
    lastNtpRequestTime.current = null;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopHeartbeat();
    };
  }, [stopHeartbeat]);

  return {
    startHeartbeat,
    stopHeartbeat,
    markNTPResponseReceived,
  };
};
