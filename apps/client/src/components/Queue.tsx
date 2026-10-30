import React from "react";
import { clearUpcoming, saveQueueAsPlaylist } from "@/lib/queueActions";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useCanMutate, useGlobalStore } from "@/store/global";
import { AnimatePresence, motion } from "motion/react";
import LoadDefaultTracksButton from "./LoadDefaultTracksButton";
import {
  closestCenter,
  DndContext,
  DragEndEvent,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { restrictToVerticalAxis, restrictToWindowEdges } from "@dnd-kit/modifiers";
import { QueueSortableItem } from "./QueueSortableItem";

export const Queue = ({ className, ...rest }: React.ComponentProps<"div">) => {
  const audioSources = useGlobalStore((state) => state.audioSources);
  const isInitingSystem = useGlobalStore((state) => state.isInitingSystem);
  const broadcastReorder = useGlobalStore((state) => state.broadcastReorder);
  const canMutate = useCanMutate();
  // socket handled by child button component when needed

  const sensors = useSensors(
    useSensor(MouseSensor),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 250,
        tolerance: 5,
      },
    })
  );

  function handleDragEnd(event: DragEndEvent): void {
    if (!canMutate) return;
    const { active, over } = event;
    if (!over) return;
    if (active.id !== over.id) {
      const oldIndex = audioSources.findIndex((src) => src.source.url === active.id);
      const newIndex = audioSources.findIndex((src) => src.source.url === over.id);
      const newAudioSources = arrayMove(audioSources, oldIndex, newIndex);

      const modified = newAudioSources.map((it) => ({ url: it.source.url }));
      broadcastReorder(modified);
    }
  }

  return (
    <div className={cn("", className)} {...rest}>
      {/* <h2 className="text-xl font-bold mb-2 select-none">Beatsync</h2> */}
      {audioSources.length > 0 && (
        <div className="flex items-center justify-end gap-1.5 mb-1">
          <button
            type="button"
            onClick={() => {
              const saved = saveQueueAsPlaylist();
              if (saved > 0) toast.success(`Saved ${saved} song${saved === 1 ? "" : "s"} as a playlist`);
              else toast.info("Only YouTube songs can be saved to a playlist");
            }}
            className="text-[10px] font-mono px-2 py-0.5 rounded text-neutral-300 bg-neutral-800 hover:bg-neutral-700 cursor-pointer"
          >
            save as playlist
          </button>
          {canMutate && audioSources.length > 1 && (
            <button
              type="button"
              title="Remove everything except the current song"
              onClick={() => {
                if (window.confirm("Clear the queue? The current song stays.")) clearUpcoming();
              }}
              className="text-[10px] font-mono px-2 py-0.5 rounded text-neutral-300 bg-neutral-800 hover:bg-neutral-700 cursor-pointer"
            >
              clear
            </button>
          )}
        </div>
      )}
      <div className="space-y-1">
        {audioSources.length > 0 ? (
          canMutate ? (
            <DndContext
              sensors={sensors}
              onDragEnd={handleDragEnd}
              collisionDetection={closestCenter}
              modifiers={[restrictToVerticalAxis, restrictToWindowEdges]}
            >
              <SortableContext items={audioSources.map((src) => src.source.url)} strategy={verticalListSortingStrategy}>
                <AnimatePresence initial={true}>
                  {/* Ensure keys are stable and unique even if duplicates attempted */}
                  {audioSources.map((sourceState, index) => {
                    return (
                      <QueueSortableItem
                        key={sourceState.source.url}
                        id={sourceState.source.url}
                        sourceState={sourceState}
                        index={index}
                        canMutate={canMutate}
                      />
                    );
                  })}
                </AnimatePresence>
              </SortableContext>
            </DndContext>
          ) : (
            <AnimatePresence initial={true}>
              {/* Read-only view for non-admins */}
              {audioSources.map((sourceState, index) => {
                return (
                  <QueueSortableItem
                    key={sourceState.source.url}
                    id={sourceState.source.url}
                    sourceState={sourceState}
                    index={index}
                    canMutate={canMutate}
                  />
                );
              })}
            </AnimatePresence>
          )
        ) : (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="w-full text-center text-neutral-300 select-none flex flex-col items-center justify-center gap-3"
          >
            {isInitingSystem ? (
              "Loading tracks..."
            ) : canMutate ? (
              <>
                <div className="text-sm text-neutral-400">No tracks yet</div>
                <LoadDefaultTracksButton />
              </>
            ) : (
              "No tracks available"
            )}
          </motion.div>
        )}
      </div>
    </div>
  );
};
