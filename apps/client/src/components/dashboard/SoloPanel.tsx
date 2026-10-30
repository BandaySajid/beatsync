"use client";

import { cn } from "@/lib/utils";
import { Headphones } from "lucide-react";
import { motion } from "motion/react";
import { AudioUploaderMinimal } from "../AudioUploaderMinimal";
import { Separator } from "../ui/separator";
import { RoomQRCode } from "./CopyRoom";
import { GlobalVolumeControl } from "./GlobalVolumeControl";
import { YoutubeUrlInput } from "./YoutubeUrlInput";

/** Side panel for a solo session: inviting friends and adding your own music. */
export const SoloPanel = ({ className }: { className?: string }) => {
  return (
    <motion.div
      className={cn(
        "w-full lg:w-80 lg:flex-shrink-0 border-r border-neutral-800/50 bg-neutral-900/50 backdrop-blur-md flex flex-col pb-4 lg:pb-0 text-sm overflow-y-auto",
        className
      )}
    >
      <div className="px-3.5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2 font-medium">
          <Headphones size={18} />
          <span>Listening solo</span>
        </div>
        <RoomQRCode />
      </div>
      <p className="px-3.5 pb-3 text-xs text-neutral-500">
        Your session is private. Share the QR or link to listen together; the room view appears when a friend joins.
      </p>

      <Separator className="bg-neutral-800/50" />

      <div className="block lg:hidden">
        <GlobalVolumeControl isMobile />
        <Separator className="bg-neutral-800/50" />
      </div>

      <div className="pl-1 pt-2">
        <AudioUploaderMinimal />
        <YoutubeUrlInput />
      </div>
    </motion.div>
  );
};
