"use client";
import type { BrowseCardType, MoodCategoryType } from "@beatsync/shared";
import { create } from "zustand";

export type BrowseView =
  | { kind: "moods" }
  | { kind: "mood"; category: MoodCategoryType }
  | { kind: "card"; card: BrowseCardType } // a playlist, album or artist
  | { kind: "artistByName"; name: string } // from a song, which only knows its artist's name
  | { kind: "mix"; index: number; title: string }; // one of today's daily mixes

export type SidePanelTab = "library" | "browse";

// Enough to walk back through a browsing session without growing forever.
const MAX_HISTORY = 30;

interface BrowseState {
  tab: SidePanelTab;
  stack: BrowseView[]; // Last entry is the page shown
  setTab: (tab: SidePanelTab) => void;
  open: (view: BrowseView) => void;
  back: () => void;
  openArtist: (name: string) => void;
}

/** Where the solo side panel is: its tab, and the pages opened while browsing. */
export const useBrowseStore = create<BrowseState>((set) => ({
  tab: "library",
  stack: [{ kind: "moods" }],
  setTab: (tab) => set({ tab }),
  open: (view) => set((state) => ({ stack: [state.stack[0], ...state.stack.slice(1).slice(-MAX_HISTORY), view] })),
  back: () => set((state) => ({ stack: state.stack.length > 1 ? state.stack.slice(0, -1) : state.stack })),
  openArtist: (name) =>
    set((state) => ({
      tab: "browse",
      stack: [state.stack[0], ...state.stack.slice(1).slice(-MAX_HISTORY), { kind: "artistByName", name }],
    })),
}));

/** What a page is called, for the back button that returns to it. */
export const browseViewTitle = (view: BrowseView): string => {
  switch (view.kind) {
    case "moods":
      return "Moods & genres";
    case "mood":
      return view.category.title;
    case "card":
      return view.card.title;
    case "artistByName":
      return view.name;
    case "mix":
      return view.title;
  }
};
