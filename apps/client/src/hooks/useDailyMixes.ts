import { fetchRadio } from "@/lib/api";
import { blendMix, today, todaysMixSeeds, type MixSeed } from "@/lib/dailyMixes";
import { trackFromSearchResult, type LibraryTrack } from "@/lib/libraryTrack";
import { useLibraryStore } from "@/store/library";
import { useQueries } from "@tanstack/react-query";
import { useEffect, useState } from "react";

// The server caches radios for hours; a mix doesn't need fresher songs within a day.
const RADIO_STALE_MS = 60 * 60 * 1000;

export interface DailyMix {
  title: string;
  seed: MixSeed;
  tracks: LibraryTrack[] | null; // null while the radio loads
  isError: boolean;
  refetch: () => void;
}

/** Today's mixes from what you like and play (empty until there's something to go on). */
export const useDailyMixes = (): DailyMix[] => {
  const liked = useLibraryStore((state) => state.liked);
  const history = useLibraryStore((state) => state.history);
  const [seeds, setSeeds] = useState<MixSeed[]>([]);
  const day = today();

  // Read after mount: localStorage isn't available while rendering on the server.
  useEffect(() => {
    setSeeds(todaysMixSeeds(liked, history, day));
  }, [liked, history, day]);

  const radios = useQueries({
    queries: seeds.map((mix) => ({
      queryKey: ["browse", "radio", mix.seed.id],
      queryFn: () => fetchRadio(mix.seed.id),
      staleTime: RADIO_STALE_MS,
    })),
  });

  return seeds.map((seed, index) => {
    const radio = radios[index];
    return {
      title: `Daily Mix ${index + 1}`,
      seed,
      tracks: radio?.data ? blendMix(seed, radio.data.tracks.map(trackFromSearchResult), day) : null,
      isError: radio?.isError ?? false,
      refetch: () => void radio?.refetch(),
    };
  });
};

/** "Jagjit Singh, Pritam, Kumar Sanu and more": the first few artists in a mix. */
export const mixArtists = (mix: DailyMix): string => {
  // Songs can credit several artists in one name ("Asha Bhosle, Mohammed Rafi"); "&" is
  // left alone, it's part of band names ("She & Him").
  const artists = [mix.seed.artist, ...(mix.tracks ?? []).flatMap((track) => track.artist.split(", "))];
  const names = [...new Set(artists)].slice(0, 3);
  return `${names.join(", ")} and more`;
};
