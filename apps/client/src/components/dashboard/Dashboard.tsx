import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIsSoloLayout } from "@/hooks/useIsSoloLayout";
import { useBrowseStore } from "@/store/browse";
import { useGlobalStore } from "@/store/global";
import { Headphones, Library, ListMusic, PartyPopper } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { TopBar } from "../room/TopBar";
import { SyncProgress } from "../ui/SyncProgress";
import { BeatFlash } from "./BeatFlash";
import { Bottom } from "./Bottom";
import { Left } from "./Left";
import { Main } from "./Main";
import { Right } from "./Right";
import { SoloPanel } from "./SoloPanel";

interface DashboardProps {
  roomId: string;
}

export const Dashboard = ({ roomId }: DashboardProps) => {
  const isSynced = useGlobalStore((state) => state.isSynced);
  const isLoadingAudio = useGlobalStore((state) => state.isInitingSystem);
  const hasUserStartedSystem = useGlobalStore((state) => state.hasUserStartedSystem);
  const reconnectionInfo = useGlobalStore((state) => state.reconnectionInfo);
  const isSoloLayout = useIsSoloLayout();
  const [mobileSoloTab, setMobileSoloTab] = useState("music");
  // On phones the panel is its own tab: switch to it when Home opens a page there.
  const showCount = useBrowseStore((state) => state.showCount);
  const [seenShowCount, setSeenShowCount] = useState(showCount);
  if (showCount !== seenShowCount) {
    setSeenShowCount(showCount);
    setMobileSoloTab("solo");
  }

  const isReady = isSynced && !isLoadingAudio;
  // Transient disconnects keep isSynced (and therefore playback/UI) intact and
  // reconnect in the background. Only surface the blocking screen once the
  // retry budget is exhausted or the initial calibration never completed.
  const hasReconnectionFailed =
    reconnectionInfo.isReconnecting && reconnectionInfo.currentAttempt >= reconnectionInfo.maxAttempts;
  const showSyncOverlay = !isLoadingAudio && hasUserStartedSystem && (!isSynced || hasReconnectionFailed);

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        duration: 0.5,
        staggerChildren: 0.1,
      },
    },
  };

  return (
    <div className="w-full h-dvh flex flex-col text-white bg-neutral-950">
      <BeatFlash />
      {/* Top bar: Fixed height */}
      <TopBar roomId={roomId} />

      {/* Show SyncProgress during initial calibration or after reconnect attempts are exhausted */}
      {showSyncOverlay && <SyncProgress />}

      {isReady && (
        <motion.div
          className="flex flex-1 flex-col overflow-hidden min-h-0"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          {/* --- DESKTOP LAYOUT (lg+) --- */}
          <div className="hidden lg:flex lg:flex-1 lg:overflow-hidden min-h-0">
            {isSoloLayout ? (
              <>
                <SoloPanel className="flex" />
                <Main />
              </>
            ) : (
              <>
                <Left className="flex" />
                <Main />
                <Right />
              </>
            )}
          </div>

          {/* --- MOBILE SOLO LAYOUT (< lg) --- */}
          {isSoloLayout && (
            <div className="flex flex-1 flex-col lg:hidden min-h-0">
              <Tabs
                value={mobileSoloTab}
                onValueChange={setMobileSoloTab}
                className="flex-1 flex flex-col overflow-hidden min-h-0"
              >
                <TabsList className="shrink-0 grid w-full grid-cols-2 h-12 rounded-none p-0 bg-gradient-to-r from-neutral-950 via-neutral-900 to-neutral-950">
                  <TabsTrigger
                    value="music"
                    className="flex-1 data-[state=active]:bg-white/5 data-[state=active]:shadow-none rounded-none text-xs h-full gap-1 text-neutral-400 data-[state=active]:text-white transition-all duration-200"
                  >
                    <ListMusic size={16} /> Music
                  </TabsTrigger>
                  <TabsTrigger
                    value="solo"
                    className="flex-1 data-[state=active]:bg-white/5 data-[state=active]:shadow-none rounded-none text-xs h-full gap-1 text-neutral-400 data-[state=active]:text-white transition-all duration-200"
                  >
                    <Headphones size={16} /> Library
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="music" className="flex-1 overflow-y-auto mt-0 min-h-0">
                  <Main />
                </TabsContent>
                <TabsContent value="solo" className="flex-1 overflow-y-auto mt-0 min-h-0">
                  <SoloPanel className="flex h-full w-full" />
                </TabsContent>
              </Tabs>
            </div>
          )}

          {/* --- MOBILE LAYOUT (< lg) --- */}
          {!isSoloLayout && (
            <div className="flex flex-1 flex-col lg:hidden min-h-0">
              <Tabs defaultValue="queue" className="flex-1 flex flex-col overflow-hidden min-h-0">
                {/* Tab List at the top for mobile */}
                <TabsList className="shrink-0 grid w-full grid-cols-3 h-12 rounded-none p-0 bg-gradient-to-r from-neutral-950 via-neutral-900 to-neutral-950">
                  <TabsTrigger
                    value="library"
                    className="flex-1 data-[state=active]:bg-white/5 data-[state=active]:shadow-none rounded-none text-xs h-full gap-1 text-neutral-400 data-[state=active]:text-white transition-all duration-200"
                  >
                    <Library size={16} /> Session
                  </TabsTrigger>
                  <TabsTrigger
                    value="queue"
                    className="flex-1 data-[state=active]:bg-white/5 data-[state=active]:shadow-none rounded-none text-xs h-full gap-1 text-neutral-400 data-[state=active]:text-white transition-all duration-200"
                  >
                    <ListMusic size={16} /> Music
                  </TabsTrigger>
                  <TabsTrigger
                    value="spatial"
                    className="flex-1 data-[state=active]:bg-white/5 data-[state=active]:shadow-none rounded-none text-xs h-full gap-1 text-neutral-400 data-[state=active]:text-white transition-all duration-200"
                  >
                    <PartyPopper className="h-4 w-4" /> Fun
                  </TabsTrigger>
                </TabsList>

                {/* Tab Content Area - Scrolls independently */}
                <AnimatePresence mode="sync">
                  <TabsContent key="library" value="library" className="flex-1 overflow-y-auto mt-0 min-h-0">
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.3 }}
                      className="h-full"
                    >
                      <Left className="flex h-full w-full" />
                    </motion.div>
                  </TabsContent>
                  <TabsContent key="queue" value="queue" className="flex-1 overflow-y-auto mt-0 min-h-0">
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.3 }}
                      className="h-full"
                    >
                      <Main />
                    </motion.div>
                  </TabsContent>
                  <TabsContent key="spatial" value="spatial" className="flex-1 overflow-y-auto mt-0 min-h-0">
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.3 }}
                      className="h-full"
                    >
                      <Right />
                    </motion.div>
                  </TabsContent>
                </AnimatePresence>
              </Tabs>
            </div>
          )}

          {/* Bottom Player: Fixed height, outside the scrollable/tab area */}
          <Bottom />
        </motion.div>
      )}
    </div>
  );
};
