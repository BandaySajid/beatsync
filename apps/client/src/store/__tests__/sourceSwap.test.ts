import { describe, expect, it } from "bun:test";
import { useGlobalStore } from "@/store/global";

const PLACEHOLDER = "/stream/youtube/dQw4w9WgXcQ/Song___abc.m4a";
const R2_URL = "https://cdn.example.com/youtube/dQw4w9WgXcQ/Song___yt.m4a";

describe("placeholder -> R2 source swap", () => {
  it("keeps the decoded buffer so the R2 copy is not downloaded again", async () => {
    const buffer = { duration: 200 } as AudioBuffer;
    useGlobalStore.setState({
      audioSources: [{ source: { url: PLACEHOLDER }, status: "loaded", buffer }],
      bufferAccessQueue: [PLACEHOLDER],
      selectedAudioUrl: PLACEHOLDER,
    });

    await useGlobalStore.getState().handleSetAudioSources({
      type: "SET_AUDIO_SOURCES",
      sources: [{ url: R2_URL }],
      replacedSources: [{ from: PLACEHOLDER, to: R2_URL }],
    });

    const state = useGlobalStore.getState();
    expect(state.selectedAudioUrl).toBe(R2_URL);
    expect(state.audioSources).toEqual([{ source: { url: R2_URL }, status: "loaded", buffer }]);
    expect(state.bufferAccessQueue).toContain(R2_URL);
  });
});
