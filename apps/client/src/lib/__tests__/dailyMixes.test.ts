import { beforeEach, describe, expect, it } from "bun:test";
import { blendMix, pickMixSeeds, todaysMixSeeds } from "@/lib/dailyMixes";
import type { LibraryTrack } from "@/lib/libraryTrack";

// 11-character ids, like YouTube's
const song = (id: string, artist: string): LibraryTrack => ({ id: id.padEnd(11, "x"), title: id, artist });

describe("daily mixes", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("builds mixes around the artists you like and play most, leaving out uploads", () => {
    const liked = [song("a1", "Jagjit Singh"), song("b1", "Arijit Singh")];
    const history = [
      song("c1", "Pritam"),
      song("c2", "Pritam"),
      song("c3", "Pritam - Topic"), // the auto-generated channel is the same artist
      song("a2", "Jagjit Singh"),
      { id: 42, title: "upload", artist: "Beatsync" }, // an upload: no radio to build a mix from
      song("u1", "YouTube"),
    ];

    const seeds = pickMixSeeds(liked, history, "2026-10-30");
    // Pritam: 3 plays; Jagjit Singh: like (2) + play; Arijit Singh: like
    expect(seeds.map((mix) => mix.artist)).toEqual(["Jagjit Singh", "Pritam", "Arijit Singh"]);
    expect(seeds[1].own.map((track) => track.title)).toEqual(["c1", "c2", "c3"]);
  });

  it("keeps a day's mixes as they are while you keep playing, and picks again the next day", () => {
    const liked = [song("a1", "Jagjit Singh")];
    const first = todaysMixSeeds(liked, [], "2026-10-30");

    // Playing a lot of something else during the day doesn't reshuffle today's mixes...
    const busyDay = Array.from({ length: 5 }, (_, i) => song(`p${i}`, "Pritam"));
    expect(todaysMixSeeds(liked, busyDay, "2026-10-30")).toEqual(first);
    // ...but tomorrow's mixes reflect it.
    expect(todaysMixSeeds(liked, busyDay, "2026-10-31")[0].artist).toBe("Pritam");
  });

  it("mixes your songs into the radio without repeats, in a different order each day", () => {
    const [mix] = pickMixSeeds([song("a1", "Jagjit Singh"), song("a2", "Jagjit Singh")], [], "2026-10-30");
    const radio = [song("a1", "Jagjit Singh"), ...Array.from({ length: 20 }, (_, i) => song(`r${i}`, "Other"))];

    const today = blendMix(mix, radio, "2026-10-30");
    expect(new Set(today.map((track) => track.id)).size).toBe(today.length);
    expect(today).toHaveLength(22); // a1 + a2 + 20 radio songs; the radio's a1 isn't repeated
    expect(blendMix(mix, radio, "2026-10-30")).toEqual(today); // same all day
    expect(blendMix(mix, radio, "2026-10-31")).not.toEqual(today);
  });
});
