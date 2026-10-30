"use client";

import { cn } from "@/lib/utils";
import { useBrowseStore, type SidePanelTab } from "@/store/browse";
import { Compass, Headphones, Library } from "lucide-react";
import { motion } from "motion/react";
import { AudioUploaderMinimal } from "../AudioUploaderMinimal";
import { Separator } from "../ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { BrowsePanel } from "./BrowsePanel";
import { RoomQRCode } from "./CopyRoom";
import { GlobalVolumeControl } from "./GlobalVolumeControl";
import { LibraryPanel } from "./LibraryPanel";
import { YoutubeUrlInput } from "./YoutubeUrlInput";

/** Side panel for a solo session: inviting friends and adding your own music. */
export const SoloPanel = ({ className }: { className?: string }) => {
  // In a store so "Go to artist" in any song's menu can switch to Browse.
  const tab = useBrowseStore((state) => state.tab);
  const setTab = useBrowseStore((state) => state.setTab);

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

      <Separator className="bg-neutral-800/50 mt-2" />
      <Tabs value={tab} onValueChange={(value) => setTab(value as SidePanelTab)} className="gap-0">
        <TabsList className="mx-3.5 mt-3 w-auto bg-neutral-800/60">
          <TabsTrigger value="library">
            <Library className="size-3.5" /> Library
          </TabsTrigger>
          <TabsTrigger value="browse">
            <Compass className="size-3.5" /> Browse
          </TabsTrigger>
        </TabsList>
        {/* Kept mounted so switching tabs doesn't lose where you were browsing */}
        <TabsContent value="library" forceMount className="data-[state=inactive]:hidden">
          <LibraryPanel />
        </TabsContent>
        <TabsContent value="browse" forceMount className="data-[state=inactive]:hidden">
          <BrowsePanel />
        </TabsContent>
      </Tabs>
    </motion.div>
  );
};
