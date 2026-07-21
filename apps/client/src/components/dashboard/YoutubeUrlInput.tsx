"use client";

import { cn } from "@/lib/utils";
import { useCanMutate, useGlobalStore } from "@/store/global";
import { sendWSRequest } from "@/utils/ws";
import { ClientActionEnum } from "@beatsync/shared";
import { Link2, Plus } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";

function isYoutubeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, "");
    return hostname === "youtube.com" || hostname === "music.youtube.com" || hostname === "youtu.be";
  } catch {
    return false;
  }
}

export function YoutubeUrlInput() {
  const [value, setValue] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [submitted, setSubmitted] = React.useState(false);

  const canMutate = useCanMutate();
  const socket = useGlobalStore((state) => state.socket);
  const activeStreamJobs = useGlobalStore((state) => state.activeStreamJobs);

  const isLoading = activeStreamJobs > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmed = value.trim();
    if (!trimmed) return;

    if (!isYoutubeUrl(trimmed)) {
      setError("Please enter a valid YouTube or YouTube Music URL");
      return;
    }

    if (!socket) {
      setError("Not connected to server");
      return;
    }

    sendWSRequest({
      ws: socket,
      request: {
        type: ClientActionEnum.enum.ADD_YOUTUBE_URL,
        youtubeUrl: trimmed,
      },
    });

    setValue("");
    setSubmitted(true);
    setTimeout(() => setSubmitted(false), 2000);
  };

  return (
    <div className="px-3.5 py-2">
      <form onSubmit={handleSubmit} className="space-y-1.5">
        <div className="relative group">
          {/* YouTube icon */}
          <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
            <AnimatePresence mode="wait">
              {isLoading ? (
                <motion.div
                  key="loading"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ duration: 0.15 }}
                >
                  <svg className="w-4 h-4" viewBox="0 0 100 100">
                    <motion.circle
                      cx="50"
                      cy="50"
                      r="35"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="8"
                      strokeLinecap="round"
                      className="text-red-400"
                      strokeDasharray={2 * Math.PI * 35 * 0.25}
                      animate={{ rotate: [0, 360] }}
                      transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                      style={{ transformOrigin: "center" }}
                    />
                  </svg>
                </motion.div>
              ) : submitted ? (
                <motion.div
                  key="done"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ duration: 0.15 }}
                >
                  <Link2 className="w-4 h-4 text-green-400" />
                </motion.div>
              ) : (
                <motion.div
                  key="idle"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ duration: 0.15 }}
                >
                  <Link2
                    className={cn(
                      "w-4 h-4 transition-colors duration-200",
                      canMutate ? "text-neutral-500 group-focus-within:text-red-400" : "text-neutral-700"
                    )}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <input
            type="url"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (error) setError(null);
            }}
            placeholder={canMutate ? "Paste youtube or music url..." : "Requires admin permissions"}
            disabled={!canMutate || isLoading}
            className={cn(
              "w-full h-9 pl-9 pr-10 border border-neutral-600/30 rounded-lg text-sm font-normal transition-all duration-200 focus:outline-none truncate",
              canMutate && !isLoading
                ? "bg-white/5 hover:bg-white/10 focus:bg-white/10 focus:ring-1 focus:ring-red-500/50 text-white placeholder:text-neutral-500"
                : "bg-neutral-800/30 text-neutral-600 placeholder:text-neutral-700 cursor-not-allowed"
            )}
          />
          {canMutate && (
            <button
              type="submit"
              disabled={!value || isLoading}
              className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-neutral-400 hover:text-white hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Plus className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Validation error */}
        <AnimatePresence>
          {error && (
            <motion.p
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.15 }}
              className="text-[10px] text-red-400 font-mono pl-0.5 overflow-hidden"
            >
              {error}
            </motion.p>
          )}
        </AnimatePresence>
      </form>
    </div>
  );
}
