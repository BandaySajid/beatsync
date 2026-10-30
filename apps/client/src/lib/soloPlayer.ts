/**
 * Playback engine for solo sessions: a single streaming <audio> element.
 *
 * Unlike the room engine (Web Audio: download + decode the whole track, then start
 * at a synchronized instant), this starts within about a second and keeps playing
 * with the screen locked. It is only used while a solo session has nobody else in
 * it; the room engine is untouched.
 */

let audio: HTMLAudioElement | null = null;
let currentUrl = "";
let callbacks: { onEnded?: () => void; onDuration?: (seconds: number) => void } = {};

const getElement = (): HTMLAudioElement => {
  if (!audio) {
    audio = new Audio();
    audio.preload = "auto";
    audio.addEventListener("ended", () => callbacks.onEnded?.());
    audio.addEventListener("durationchange", () => {
      if (audio && Number.isFinite(audio.duration)) callbacks.onDuration?.(audio.duration);
    });
  }
  return audio;
};

// A tiny silent WAV, used to unlock the element during a user gesture (iOS only
// allows play() without a gesture on an element that has already played in one).
const silentWavUrl = (): string => {
  const buffer = new ArrayBuffer(46);
  const view = new DataView(buffer);
  const writeString = (offset: number, text: string) =>
    [...text].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  writeString(0, "RIFF");
  view.setUint32(4, 38, true);
  writeString(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, 8000, true);
  view.setUint32(28, 16000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, 2, true); // one silent sample
  return URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
};

export const soloPlayer = {
  setCallbacks(next: typeof callbacks): void {
    callbacks = next;
  },

  /** Call from a user gesture so later, gesture-less play() calls are allowed. */
  unlock(): void {
    const element = getElement();
    if (currentUrl) return;
    element.src = silentWavUrl();
    void element.play().catch(() => undefined);
  },

  /** Start (or seek) `url` at `positionSeconds`. Resolves false if the browser blocked it. */
  async play(url: string, positionSeconds: number): Promise<boolean> {
    const element = getElement();
    if (url !== currentUrl) {
      currentUrl = url;
      element.src = url;
    }
    element.currentTime = positionSeconds;
    try {
      await element.play();
      return true;
    } catch (error) {
      console.warn("[SoloPlayer] play() was blocked or failed:", error);
      return false;
    }
  },

  pause(): void {
    audio?.pause();
  },

  /** Stop and release the stream (used when handing over to the room engine). */
  stop(): void {
    if (!audio) return;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    currentUrl = "";
  },

  get currentTime(): number {
    return audio?.currentTime ?? 0;
  },

  get isPlaying(): boolean {
    return !!audio && !audio.paused && !audio.ended;
  },

  setVolume(volume: number): void {
    getElement().volume = Math.max(0, Math.min(1, volume));
  },
};
