import { useIsSoloLayout } from "@/hooks/useIsSoloLayout";
import { cn } from "@/lib/utils";
import { useGlobalStore } from "@/store/global";
import { motion } from "motion/react";
import { useState } from "react";
import { Queue } from "../Queue";
import { InlineSearch } from "./InlineSearch";
import { SimilarSongs } from "./SimilarSongs";
import { SoloHome } from "./SoloHome";

export const Main = () => {
  const isSoloLayout = useIsSoloLayout();
  const queueLength = useGlobalStore((state) => state.audioSources.length);
  // A solo session lands on Home; the queue is one tap away.
  const [view, setView] = useState<"home" | "queue">("home");
  const showHome = isSoloLayout && view === "home";

  return (
    <motion.div
      className={cn(
        "w-full lg:flex-1 overflow-y-auto bg-gradient-to-b from-neutral-900/90 to-neutral-950 backdrop-blur-xl bg-neutral-950 h-full",
        "scrollbar-thin scrollbar-thumb-rounded-md scrollbar-thumb-muted-foreground/10 scrollbar-track-transparent hover:scrollbar-thumb-muted-foreground/20"
      )}
    >
      <motion.div className="p-6 pt-4">
        {/* <h1 className="text-xl font-semibold mb-8">BeatSync</h1> */}
        <div className="mb-6">
          <InlineSearch />
        </div>
        {isSoloLayout && (
          <div role="tablist" className="flex gap-1.5 mb-6">
            {(["home", "queue"] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="tab"
                aria-selected={view === option}
                onClick={() => setView(option)}
                className={cn(
                  "px-3 py-1 rounded-full text-sm cursor-pointer transition-colors",
                  view === option ? "bg-white text-black" : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
                )}
              >
                {option === "home" ? "Home" : `Queue${queueLength > 0 ? ` · ${queueLength}` : ""}`}
              </button>
            ))}
          </div>
        )}
        {showHome ? (
          <SoloHome />
        ) : (
          <>
            <Queue className="mb-8" />
            <SimilarSongs className="mb-8" />
          </>
        )}
      </motion.div>
    </motion.div>
  );
};
