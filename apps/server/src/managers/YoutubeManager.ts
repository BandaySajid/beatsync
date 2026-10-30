import fs from "fs";
import path from "path";
import { ClientType, Innertube } from "youtubei.js";
import { R2_AUDIO_FILE_NAME_DELIMITER, type TrackType } from "@beatsync/shared";

interface YtDlpJsonOutput {
  id?: string;
  title?: string;
  fulltitle?: string;
  duration?: number;
  uploader?: string;
}

export interface YoutubeStreamInfo {
  url: string;
  mimeType: string;
  contentLength: number;
  title: string;
  expiresAt: number;
  mode: "proxy" | "pipe";
  userAgent?: string;
}

export interface PipedAudioStream {
  stream: ReadableStream<Uint8Array>;
  kill: () => void;
  exited: Promise<number>;
}

interface YtDlpAudioInfo {
  url: string;
  mimeType: string;
  contentLength: number;
  title?: string;
  userAgent?: string;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

const readText = (value: unknown, nestedKey: string): string | undefined => {
  if (typeof value === "string") return value;
  const record = asRecord(value);
  const nested = record?.[nestedKey];
  return typeof nested === "string" ? nested : undefined;
};

const toYoutubeTrack = (id: string, title: string, author: string, duration: number): TrackType => ({
  id,
  title,
  duration,
  parental_warning: false,
  track_number: 1,
  performer: {
    name: author,
    id: 0,
  },
  album: {
    title: "YouTube",
    id: "0",
    duration,
    parental_warning: false,
    release_date_original: new Date().toISOString(),
    image: {
      thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      small: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      large: `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
    },
  },
});

const COOKIES_FILE = path.join(process.cwd(), "cookies.txt");
const STREAM_PATH_PREFIX = "/stream/youtube";
const STREAM_CACHE_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_STREAM_CACHE_ENTRIES = 128;
const RANGE_VALIDATION_TIMEOUT_MS = 3000;
const RESOLVE_ATTEMPTS = 2;
const RANGE_LIMIT_STATUSES = new Set([403, 410, 416]);
const MAX_TITLE_LENGTH = 120;
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const MAX_SUGGESTIONS = 10;
// Each prewarm can spawn a yt-dlp process, so keep this small.
const PREWARM_COUNT = 3;
const MAX_PARALLEL_CACHE_CHUNKS = 6;
// Audio-only files are ~5-8 MB, so this holds roughly 60-100 tracks while
// staying far away from the host's RAM/disk limits.
const MAX_CACHE_BYTES = 512 * 1024 * 1024;
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";
const IOS_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
// Keep the cache on real disk. The previous /tmp default was a tmpfs on the
// production host, so a large cache competed with system RAM. This new path
// also gives us a clean directory that cannot contain old muxed video files.
const CACHE_DIR = process.env.BEATSYNC_CACHE_DIR?.trim() ?? path.join(process.cwd(), "cache", "youtube");

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class YoutubeManager {
  private innertube: Innertube | null = null;
  private streamInnertubePromise: Promise<Innertube> | null = null;
  private streamCache = new Map<string, YoutubeStreamInfo>();
  private streamJobs = new Map<string, Promise<YoutubeStreamInfo>>();
  private streamGenerations = new Map<string, number>();
  private preloadJobs = new Map<string, Promise<string | null>>();
  private readonly cacheDir = CACHE_DIR;

  getCacheFilePath(videoId: string): string {
    if (!VIDEO_ID_PATTERN.test(videoId)) {
      throw new Error(`Invalid YouTube video ID: ${videoId}`);
    }
    return path.join(this.cacheDir, `${videoId}.m4a`);
  }

  isCached(videoId: string): boolean {
    try {
      const filePath = this.getCacheFilePath(videoId);
      if (!fs.existsSync(filePath)) return false;
      const stat = fs.statSync(filePath);
      return stat.size > 100_000;
    } catch {
      return false;
    }
  }

  /**
   * Preload a YouTube video's audio into the local filesystem cache.
   * Downloads parallel 1 MiB byte chunks from googlevideo so the entire song
   * is buffered on disk in ~1s and served locally to clients in ~10ms.
   */
  async preloadVideo(videoId: string): Promise<string | null> {
    if (this.isCached(videoId)) return this.getCacheFilePath(videoId);

    const existing = this.preloadJobs.get(videoId);
    if (existing) return existing;

    const job = (async () => {
      const tempFiles = new Set<string>();

      try {
        if (!fs.existsSync(this.cacheDir)) {
          fs.mkdirSync(this.cacheDir, { recursive: true });
        }

        const info = await this.getStreamInfo(videoId);
        if (info.mode === "pipe" || !info.url || info.contentLength <= 0) {
          return null;
        }

        const streamUrl = info.url;
        const targetFile = this.getCacheFilePath(videoId);
        const stamp = Date.now();
        const muxedTemp = `${targetFile}.${stamp}.source.tmp`;
        const audioTemp = `${targetFile}.${stamp}.audio.tmp`;
        tempFiles.add(muxedTemp);
        tempFiles.add(audioTemp);
        const totalSize = info.contentLength;
        const chunkSize = 1024 * 1024;
        const chunkCount = Math.ceil(totalSize / chunkSize);
        const userAgent = info.userAgent ?? DEFAULT_USER_AGENT;

        const chunks = new Array<Uint8Array>(chunkCount);
        let nextIndex = 0;

        const downloadChunk = async () => {
          for (;;) {
            const index = nextIndex++;
            if (index >= chunkCount) return;

            const start = index * chunkSize;
            const end = Math.min(start + chunkSize - 1, totalSize - 1);
            const response = await fetch(streamUrl, {
              headers: {
                "User-Agent": userAgent,
                Referer: "https://www.youtube.com/",
                Range: `bytes=${start}-${end}`,
              },
            });

            if (!response.ok && response.status !== 206) {
              throw new Error(`Chunk ${index} failed with status ${response.status}`);
            }

            const buffer = new Uint8Array(await response.arrayBuffer());
            const expected = end - start + 1;
            if (buffer.byteLength !== expected) {
              throw new Error(`Chunk ${index} returned ${buffer.byteLength}/${expected} bytes`);
            }
            chunks[index] = buffer;
          }
        };

        await Promise.all(
          Array.from({ length: Math.min(MAX_PARALLEL_CACHE_CHUNKS, chunkCount) }, () => downloadChunk())
        );

        const fullBuffer = new Uint8Array(totalSize);
        let offset = 0;
        for (const chunk of chunks) {
          if (!chunk) throw new Error(`Missing chunk at offset ${offset}`);
          fullBuffer.set(chunk, offset);
          offset += chunk.byteLength;
        }
        if (offset !== totalSize) throw new Error(`Cached ${offset}/${totalSize} bytes`);

        await Bun.write(muxedTemp, fullBuffer);

        // The reliable android stream is muxed video+audio. Strip the video
        // track with a stream copy: no re-encode, ~0.15s for a full song, and
        // the resulting audio is the same 128kbps AAC as the audio-only format.
        const extracted = await this.extractAudioFile(muxedTemp, audioTemp);
        const finalTemp = extracted ? audioTemp : muxedTemp;
        if (!extracted) {
          console.warn(`[YouTube] ffmpeg extraction unavailable for ${videoId}; caching the muxed file`);
        }

        fs.renameSync(finalTemp, targetFile);
        // The chosen temp was renamed; clean up the unused one immediately.
        fs.rmSync(extracted ? muxedTemp : audioTemp, { force: true });
        tempFiles.delete(muxedTemp);
        tempFiles.delete(audioTemp);
        console.log(
          `[YouTube] Successfully cached ${fs.statSync(targetFile).size} audio bytes for ${videoId} at ${targetFile}`
        );
        this.pruneCache(targetFile);
        return targetFile;
      } catch (error) {
        for (const tempFile of tempFiles) {
          try {
            fs.rmSync(tempFile, { force: true });
          } catch {
            // Already removed.
          }
        }
        console.warn(`[YouTube] Preload / cache failed for ${videoId}:`, error);
        return null;
      } finally {
        for (const tempFile of tempFiles) {
          try {
            fs.rmSync(tempFile, { force: true });
          } catch {
            // Already removed.
          }
        }
        this.preloadJobs.delete(videoId);
      }
    })();

    this.preloadJobs.set(videoId, job);
    return job;
  }

  /**
   * Strip the video track from a muxed MP4 with a stream copy. Unlike a full
   * transcode this takes ~0.15s, preserves the exact 128kbps AAC audio, and
   * roughly halves the bytes sent to clients.
   */
  private async extractAudioFile(inputPath: string, outputPath: string): Promise<boolean> {
    const ffmpeg = process.env.FFMPEG_PATH?.trim() ?? Bun.which("ffmpeg");
    if (!ffmpeg) return false;

    try {
      const proc = Bun.spawn(
        [
          ffmpeg,
          "-y",
          "-loglevel",
          "error",
          "-nostdin",
          "-i",
          inputPath,
          "-vn",
          "-c:a",
          "copy",
          "-movflags",
          "+faststart",
          "-f",
          "mp4",
          outputPath,
        ],
        { stdout: "ignore", stderr: "pipe" }
      );
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        console.warn(`[YouTube] ffmpeg exited ${exitCode}: ${stderr.trim().slice(0, 200)}`);
        return false;
      }
      return fs.existsSync(outputPath) && fs.statSync(outputPath).size > 100_000;
    } catch (error) {
      console.warn("[YouTube] ffmpeg audio extraction failed:", error);
      return false;
    }
  }

  /** Keep the cache bounded so long-lived servers cannot fill their disk. */
  private pruneCache(keepFile?: string): void {
    try {
      const entries = fs.readdirSync(this.cacheDir, { withFileTypes: true });
      const now = Date.now();
      const cachedFiles: { path: string; size: number; mtimeMs: number }[] = [];

      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const fullPath = path.join(this.cacheDir, entry.name);

        try {
          const stat = fs.statSync(fullPath);
          if (entry.name.endsWith(".tmp") && now - stat.mtimeMs > 60 * 60 * 1000) {
            fs.rmSync(fullPath, { force: true });
            continue;
          }
          if (entry.name.endsWith(".m4a")) {
            cachedFiles.push({ path: fullPath, size: stat.size, mtimeMs: stat.mtimeMs });
          }
        } catch {
          // Ignore files that disappear while pruning.
        }
      }

      let totalSize = cachedFiles.reduce((sum, file) => sum + file.size, 0);
      if (totalSize <= MAX_CACHE_BYTES) return;

      cachedFiles.sort((a, b) => a.mtimeMs - b.mtimeMs);
      for (const file of cachedFiles) {
        if (totalSize <= MAX_CACHE_BYTES) break;
        if (file.path === keepFile) continue;

        try {
          fs.rmSync(file.path, { force: true });
          totalSize -= file.size;
        } catch {
          // Ignore deletion failures.
        }
      }
    } catch {
      // Cache pruning is best-effort.
    }
  }

  private async getInnertube(): Promise<Innertube> {
    this.innertube ??= await Innertube.create();
    return this.innertube;
  }

  /** Returns true if the given URL looks like a YouTube or YouTube Music URL */
  static isYoutubeUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname.replace(/^www\./, "");
      return hostname === "youtube.com" || hostname === "music.youtube.com" || hostname === "youtu.be";
    } catch {
      return false;
    }
  }

  static getVideoId(url: string): string | null {
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname.replace(/^www\./, "");
      let videoId: string | null = null;
      if (hostname === "youtu.be") videoId = parsed.pathname.split("/").find(Boolean) ?? null;
      if (hostname === "youtube.com" || hostname === "music.youtube.com") {
        if (parsed.pathname === "/watch") videoId = parsed.searchParams.get("v");
        const parts = parsed.pathname.split("/").filter(Boolean);
        if (["shorts", "embed", "live"].includes(parts[0] ?? "")) videoId = parts[1] ?? null;
      }
      return videoId && VIDEO_ID_PATTERN.test(videoId) ? videoId : null;
    } catch {
      return null;
    }
  }

  static isStreamUrl(url: string): boolean {
    try {
      const pathname = url.startsWith("http") ? new URL(url).pathname : url.split(/[?#]/, 1)[0];
      return new RegExp(`^${STREAM_PATH_PREFIX}/[A-Za-z0-9_-]{11}(?:/|$)`).test(pathname);
    } catch {
      return false;
    }
  }

  static getStreamUrl(videoId: string, title: string): string {
    const safeTitle =
      title
        .replace(/[/\\?%*:|"<>]/g, "-")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, MAX_TITLE_LENGTH) || "YouTube Track";
    const stamp = Date.now().toString(36);
    return `${STREAM_PATH_PREFIX}/${videoId}/${encodeURIComponent(safeTitle)}${R2_AUDIO_FILE_NAME_DELIMITER}${stamp}.m4a`;
  }

  private getExtractorArgs(): string[] {
    const configuredClient = process.env.YT_DLP_PLAYER_CLIENT?.trim();
    if (configuredClient === "default") return [];
    const playerClient = configuredClient?.length ? configuredClient : "visionos";
    return ["--extractor-args", `youtube:player_client=${playerClient}`];
  }

  private readCookieHeader(): string | undefined {
    try {
      if (!fs.existsSync(COOKIES_FILE)) return undefined;

      const pairs = new Map<string, string>();
      for (const rawLine of fs.readFileSync(COOKIES_FILE, "utf8").split(/\r?\n/)) {
        let line = rawLine.trim();
        if (!line) continue;
        if (line.startsWith("#HttpOnly_")) line = line.slice("#HttpOnly_".length);
        if (line.startsWith("#")) continue;

        const parts = line.split("\t");
        if (parts.length < 7) continue;

        const domain = parts[0].replace(/^\./, "").toLowerCase();
        if (domain !== "youtube.com" && !domain.endsWith(".youtube.com")) continue;
        pairs.set(parts[5], parts[6]);
      }

      if (pairs.size === 0) return undefined;
      return Array.from(pairs, ([name, value]) => `${name}=${value}`).join("; ");
    } catch (error) {
      console.warn("[YouTube] Failed to read cookies.txt:", error);
      return undefined;
    }
  }

  private async createStreamInnertube(): Promise<Innertube> {
    const cookie = this.readCookieHeader();
    const options = {
      client_type: ClientType.IOS,
      retrieve_player: false,
      generate_session_locally: true,
    };

    if (!cookie) return Innertube.create(options);

    try {
      return await Innertube.create({ ...options, cookie });
    } catch (error) {
      console.warn("[YouTube] Cookie-authenticated stream session failed, retrying anonymously:", error);
      return Innertube.create(options);
    }
  }

  private getStreamInnertube(): Promise<Innertube> {
    this.streamInnertubePromise ??= this.createStreamInnertube().catch((error) => {
      this.streamInnertubePromise = null;
      throw error;
    });
    return this.streamInnertubePromise;
  }

  /**
   * Check whether the direct URL can serve a byte near the end of the track.
   * Validates Range support with the matching User-Agent.
   */
  private async detectRangeLimit(url: string, contentLength: number, userAgent?: string): Promise<boolean> {
    if (contentLength <= 0) return false;

    const start = Math.max(0, contentLength - 1024);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RANGE_VALIDATION_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": userAgent ?? DEFAULT_USER_AGENT,
          Referer: "https://www.youtube.com/",
          Range: `bytes=${start}-${contentLength - 1}`,
        },
        signal: controller.signal,
      });

      if (RANGE_LIMIT_STATUSES.has(response.status)) {
        await response.body?.cancel().catch(() => undefined);
        return true;
      }

      // Read at most one chunk, then cancel. Never buffer the full response.
      const reader = response.body?.getReader();
      if (reader) {
        await reader.read().catch(() => undefined);
        await reader.cancel().catch(() => undefined);
      }

      return false;
    } catch {
      // Timeout / DNS / transient network failure: assume the proxy path is fine.
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  private ytDlpPath(): string | null {
    const configured = process.env.YT_DLP_PATH?.trim();
    if (configured) return configured;
    return Bun.which("yt-dlp");
  }

  /** Streams yt-dlp's stdout directly to the caller, without touching disk or R2. */
  createPipedAudioStream(videoId: string, mimeType: string): PipedAudioStream {
    const extension = mimeType.startsWith("audio/webm") ? "webm" : "m4a";
    const ytDlp = this.ytDlpPath();
    if (!ytDlp) throw new Error("yt-dlp is not installed; cannot pipe this YouTube stream");

    const args = [
      ytDlp,
      "-4",
      "-o",
      "-",
      "-f",
      `bestaudio[ext=${extension}][abr<=160]/bestaudio[ext=${extension}]/bestaudio/best`,
      "--no-playlist",
      "--no-warnings",
      "--no-progress",
      "--http-chunk-size",
      "1M",
      "--retries",
      "3",
      "--fragment-retries",
      "3",
      "--extractor-args",
      "youtube:player_client=android",
    ];
    args.push(`https://www.youtube.com/watch?v=${videoId}`);

    const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });

    void new Response(proc.stderr).text().then((stderr) => {
      if (stderr.trim()) console.warn(`[YouTube] yt-dlp pipe output for ${videoId}: ${stderr.trim()}`);
    });
    void proc.exited.then((code) => {
      if (code !== 0) console.warn(`[YouTube] yt-dlp pipe exited with ${code} for ${videoId}`);
    });

    return {
      stream: proc.stdout,
      kill: () => {
        try {
          proc.kill();
        } catch {
          // Process already exited.
        }
      },
      exited: proc.exited,
    };
  }

  /** Read the total byte length of a direct URL without downloading it. */
  private async probeContentLength(url: string, userAgent?: string): Promise<number> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": userAgent ?? DEFAULT_USER_AGENT,
          Referer: "https://www.youtube.com/",
          Range: "bytes=0-0",
        },
        signal: controller.signal,
      });

      const contentRange = /\/(\d+)$/.exec(response.headers.get("content-range") ?? "");
      if (contentRange) {
        await response.body?.cancel().catch(() => undefined);
        return Number(contentRange[1]);
      }

      const contentLength = Number(response.headers.get("content-length") ?? 0);
      await response.body?.cancel().catch(() => undefined);
      return Number.isFinite(contentLength) && contentLength > 1 ? contentLength : 0;
    } catch {
      return 0;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Extract a direct audio URL with one specific yt-dlp client.
   * Forces IPv4 (-4) to avoid broken IPv6 routes and keeps the
   * User-Agent that matches the selected client.
   */
  private async extractViaYtDlp(
    videoId: string,
    client: string,
    formatSelector: string
  ): Promise<YtDlpAudioInfo | null> {
    const ytDlp = this.ytDlpPath();
    if (!ytDlp) return null;

    const baseArgs = [
      ytDlp,
      "-4",
      "-j",
      "-f",
      formatSelector,
      "--no-config",
      "--no-playlist",
      "--no-warnings",
      "--no-progress",
    ];

    if (client !== "default") {
      baseArgs.push("--extractor-args", `youtube:player_client=${client}`);
    }
    baseArgs.push(`https://www.youtube.com/watch?v=${videoId}`);

    // Expired/incomplete cookies can make yt-dlp reject every format. Public
    // clients work without them, so try anonymous first and only use the
    // cookie jar when anonymous extraction fails.
    const cookieAttempts = fs.existsSync(COOKIES_FILE) ? [false, true] : [false];

    for (const useCookies of cookieAttempts) {
      const args = [...baseArgs];
      if (useCookies) {
        args.splice(args.length - 1, 0, "--cookies", COOKIES_FILE);
      }

      const startYtDlp = () => Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
      let proc: ReturnType<typeof startYtDlp>;
      try {
        proc = startYtDlp();
      } catch (error) {
        console.warn(`[YouTube] Failed to start yt-dlp for ${videoId}:`, error);
        continue;
      }

      const killTimer = setTimeout(() => {
        try {
          proc.kill();
        } catch {
          // Process already exited.
        }
      }, 12_000);

      try {
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ]);

        if (exitCode !== 0) {
          console.warn(
            `[YouTube] yt-dlp (${client}${useCookies ? ",cookies" : ""}) extraction failed for ${videoId} (exit ${exitCode}): ${stderr
              .trim()
              .slice(0, 200)}`
          );
          continue;
        }

        const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
        const line = lines[lines.length - 1];
        if (!line) continue;

        const parsed = JSON.parse(line) as Record<string, unknown>;
        const url = typeof parsed.url === "string" ? parsed.url : null;
        if (!url) continue;

        const parsedUrl = new URL(url);
        if (!/(^|\.)(googlevideo\.com|youtube\.com)$/.test(parsedUrl.hostname)) {
          console.warn(`[YouTube] yt-dlp returned an unexpected stream host: ${parsedUrl.hostname}`);
          continue;
        }

        const ext = typeof parsed.ext === "string" ? parsed.ext : "m4a";
        const mimeType = ext === "webm" ? "audio/webm" : "audio/mp4";
        const exactSize = typeof parsed.filesize === "number" ? parsed.filesize : 0;

        const httpHeaders = asRecord(parsed.http_headers);
        const userAgent = typeof httpHeaders?.["User-Agent"] === "string" ? httpHeaders["User-Agent"] : undefined;
        const contentLength = exactSize > 0 ? exactSize : await this.probeContentLength(url, userAgent);

        return {
          url,
          mimeType,
          contentLength,
          title: typeof parsed.title === "string" ? parsed.title.trim() : undefined,
          userAgent,
        };
      } catch (error) {
        console.warn(`[YouTube] Failed to parse yt-dlp output for ${videoId}:`, error);
      } finally {
        clearTimeout(killTimer);
      }
    }

    return null;
  }

  /**
   * Resolve a rangeable direct URL through yt-dlp. Used both as the fallback
   * when Innertube is login-gated and when its IOS URL is range-limited.
   *
   * Only the android client: yt-dlp dropped ios_music/android_testsuite and silently
   * falls back to its default clients for them (measured 3-84s per call vs a steady
   * ~2.7s for android). Android's stream is muxed; preloadVideo strips the video with ffmpeg.
   */
  private async resolveViaYtDlp(videoId: string): Promise<YoutubeStreamInfo | null> {
    let fallback = await this.extractViaYtDlp(videoId, "android", "bestaudio/best");
    if (fallback && (await this.detectRangeLimit(fallback.url, fallback.contentLength, fallback.userAgent))) {
      fallback = null;
    }

    if (!fallback) return null;

    console.log(`[YouTube] Resolved ${videoId} via yt-dlp android URL`);
    let expireMs = NaN;
    try {
      expireMs = Number(new URL(fallback.url).searchParams.get("expire")) * 1000;
    } catch {
      // Missing/malformed expire; use the cache TTL.
    }

    const expiresAt =
      Number.isFinite(expireMs) && expireMs > 0
        ? Math.min(expireMs - 5 * 60 * 1000, Date.now() + STREAM_CACHE_TTL_MS)
        : Date.now() + STREAM_CACHE_TTL_MS;

    return {
      url: fallback.url,
      mimeType: fallback.mimeType,
      contentLength: fallback.contentLength,
      title: fallback.title?.trim() ?? "YouTube Track",
      expiresAt,
      mode: "proxy",
      userAgent: fallback.userAgent,
    };
  }

  private createPipeInfo(): YoutubeStreamInfo {
    return {
      url: "",
      mimeType: "audio/mp4",
      contentLength: 0,
      title: "YouTube Track",
      expiresAt: Date.now() + STREAM_CACHE_TTL_MS,
      mode: "pipe",
    };
  }

  private async resolveStreamInfo(videoId: string): Promise<YoutubeStreamInfo> {
    const ytDlpAvailable = Boolean(this.ytDlpPath());
    // Start yt-dlp alongside Innertube: Innertube wins in ~1s when its URL is usable, and
    // when it is range-limited or gated yt-dlp is already ~1s in instead of starting late.
    const ytDlpRace = ytDlpAvailable ? this.resolveViaYtDlp(videoId).catch(() => null) : Promise.resolve(null);
    let info: Awaited<ReturnType<Innertube["getBasicInfo"]>> | undefined;
    let lastError: unknown;

    for (let attempt = 1; attempt <= RESOLVE_ATTEMPTS; attempt++) {
      try {
        const yt = await this.getStreamInnertube();
        info = await yt.getBasicInfo(videoId);
        break;
      } catch (error) {
        lastError = error;
        this.streamInnertubePromise = null;
        this.innertube = null;
        if (attempt < RESOLVE_ATTEMPTS) await sleep(250 * attempt);
      }
    }

    if (!info) {
      const ytDlpInfo = await ytDlpRace;
      if (ytDlpInfo) return ytDlpInfo;
      if (ytDlpAvailable) return this.createPipeInfo();
      throw lastError instanceof Error ? lastError : new Error(`Failed to resolve YouTube video ${videoId}`);
    }

    if (info.playability_status?.status && info.playability_status.status !== "OK") {
      // Login-gated for the anonymous/cookie Innertube session. yt-dlp's public
      // clients often still resolve these, so try them before giving up.
      const ytDlpInfo = await ytDlpRace;
      if (ytDlpInfo) return ytDlpInfo;
      if (ytDlpAvailable) return this.createPipeInfo();
      throw new Error(`YouTube video ${videoId} is not playable: ${info.playability_status.status}`);
    }

    const audioFormats = (info.streaming_data?.adaptive_formats ?? []).filter(
      (format) =>
        format.has_audio && !format.has_video && !format.is_drc && !format.is_vb && format.is_original !== false
    );

    const m4aFormats = audioFormats
      .filter((format) => format.mime_type.startsWith("audio/mp4"))
      .sort((a, b) => b.bitrate - a.bitrate);

    const preferred =
      m4aFormats.find((format) => format.bitrate <= 160_000) ??
      m4aFormats[0] ??
      audioFormats.sort((a, b) => b.bitrate - a.bitrate)[0];

    const format = preferred ?? info.chooseFormat({ type: "audio", format: "mp4", quality: "best" });

    let formatUrl = format.url;
    if (!formatUrl && (format.signature_cipher || format.cipher)) {
      formatUrl = await format.decipher(info.actions.session.player);
    }
    if (!formatUrl) throw new Error(`No stream URL available for YouTube video ${videoId}`);

    const parsedUrl = new URL(formatUrl);
    if (!/(^|\.)(googlevideo\.com|youtube\.com)$/.test(parsedUrl.hostname)) {
      throw new Error(`YouTube returned an unexpected stream host: ${parsedUrl.hostname}`);
    }
    parsedUrl.searchParams.set("cpn", info.cpn);

    const streamUrl = parsedUrl.toString();
    const mimeType = format.mime_type.split(";")[0] || "audio/mp4";
    const contentLength = format.content_length ?? 0;
    const title = info.basic_info.title?.trim();

    // Some IOS-client URLs only serve their first ~1 MiB and then return 403.
    // Prefer a yt-dlp direct URL (usually fully rangeable) over piping stdout,
    // because the proxy can then use parallel ranges and seek correctly.
    if (await this.detectRangeLimit(streamUrl, contentLength, IOS_USER_AGENT)) {
      const ytDlpInfo = await ytDlpRace;
      if (ytDlpInfo) return ytDlpInfo;

      if (!ytDlpAvailable) {
        // No usable fallback: fail fast instead of serving a stream that will
        // 403 after the first megabyte.
        throw new Error(`YouTube stream for ${videoId} is range-limited and no yt-dlp fallback is available`);
      }

      console.warn(`[YouTube] Stream for ${videoId} is range-limited; using yt-dlp pipe fallback`);
      return this.createPipeInfo();
    }

    let expireMs = NaN;
    try {
      expireMs = Number(new URL(streamUrl).searchParams.get("expire")) * 1000;
    } catch {
      // Non-standard URL host — expiresAt falls back to the cache TTL.
    }

    const expiresAt =
      Number.isFinite(expireMs) && expireMs > 0
        ? Math.min(expireMs - 5 * 60 * 1000, Date.now() + STREAM_CACHE_TTL_MS)
        : Date.now() + STREAM_CACHE_TTL_MS;

    return {
      url: streamUrl,
      mimeType,
      contentLength,
      title: title?.trim() ?? "YouTube Track",
      expiresAt,
      mode: "proxy",
      userAgent: IOS_USER_AGENT,
    };
  }

  async getStreamInfo(videoId: string, options: { force?: boolean } = {}): Promise<YoutubeStreamInfo> {
    if (!VIDEO_ID_PATTERN.test(videoId)) throw new Error(`Invalid YouTube video ID: ${videoId}`);

    const cached = this.streamCache.get(videoId);

    // Several parallel chunk requests can all discover an expired URL at the
    // same moment. Reuse the refresh that is already in flight instead of
    // launching one YouTube metadata request per chunk.
    const existingJob = this.streamJobs.get(videoId);
    if (existingJob) return existingJob;

    if (options.force) {
      this.streamCache.delete(videoId);
    } else if (cached && cached.expiresAt > Date.now()) {
      return cached;
    }

    const generation = (this.streamGenerations.get(videoId) ?? 0) + 1;
    this.streamGenerations.set(videoId, generation);

    const job = this.resolveStreamInfo(videoId)
      .then((info) => {
        if (this.streamGenerations.get(videoId) === generation) {
          this.cacheStreamInfo(videoId, info);
        }
        return info;
      })
      .finally(() => {
        if (this.streamJobs.get(videoId) === job) {
          this.streamJobs.delete(videoId);
        }
      });

    this.streamJobs.set(videoId, job);
    return job;
  }

  private cacheStreamInfo(videoId: string, info: YoutubeStreamInfo): void {
    this.streamCache.delete(videoId);
    this.streamCache.set(videoId, info);

    while (this.streamCache.size > MAX_STREAM_CACHE_ENTRIES) {
      const oldestKey = this.streamCache.keys().next().value;
      if (oldestKey === undefined) break;
      this.streamCache.delete(oldestKey);
    }
  }

  /**
   * Get the first few streams ready before anyone clicks: a cold resolve needs yt-dlp
   * (~3s) and a download (~4s); a warm one is a cache hit. The top pick is fully
   * downloaded to the disk cache (bounded by MAX_CACHE_BYTES), so adding it only costs
   * the R2 upload; the rest are only resolved. Failures are ignored here; add/play retries.
   */
  prewarm(videoIds: string[]): void {
    const [topPick, ...others] = videoIds.slice(0, PREWARM_COUNT);
    if (topPick) void this.preloadVideo(topPick);
    for (const videoId of others) {
      this.getStreamInfo(videoId).catch(() => undefined);
    }
  }

  /** Resolves a YouTube URL to a stable local streaming URL for a room queue. */
  async getStreamSource(youtubeUrl: string): Promise<{ publicUrl: string; title: string }> {
    const videoId = YoutubeManager.getVideoId(youtubeUrl);
    if (!videoId) throw new Error("Unable to determine YouTube video ID");

    const info = await this.getStreamInfo(videoId);
    const publicUrl = YoutubeManager.getStreamUrl(videoId, info.title);
    console.log(`[YouTube] Streaming "${info.title}" via ${publicUrl}`);
    return { publicUrl, title: info.title };
  }

  /**
   * Searches YouTube for the query and returns up to 5 tracks formatted as TrackType.
   * Pre-warms stream extraction for the top result in the background for zero-latency clicks.
   */
  async search(query: string): Promise<TrackType[]> {
    console.log(`[YouTube] Searching for: ${query}`);

    // First, try lighting-fast youtubei.js search
    try {
      const yt = await this.getInnertube();
      const results = await yt.search(query, { type: "video" });

      if (results.videos.length > 0) {
        console.log(`[YouTube] Fast search returned ${results.videos.length} results`);
        const tracks: TrackType[] = [];

        // Take top 5
        const topVideos = results.videos.slice(0, 5);
        for (const video of topVideos) {
          const record = asRecord(video);
          if (!record) continue;
          const id = record.id;
          if (typeof id !== "string") continue;

          const durationRecord = asRecord(record.duration);
          const duration = typeof durationRecord?.seconds === "number" ? durationRecord.seconds : 0;
          const title = readText(record.title, "text") ?? "YouTube Video";
          const author = readText(record.author, "name") ?? "YouTube";

          tracks.push(toYoutubeTrack(id, title, author, duration));
        }

        // Pre-warm the top result's stream in the background!
        if (tracks.length > 0 && typeof tracks[0].id === "string") {
          void this.getStreamInfo(tracks[0].id).catch(() => undefined);
        }

        return tracks;
      }
    } catch (err) {
      console.warn(`[YouTube] Fast search failed, falling back to yt-dlp:`, err);
    }

    // Fallback to yt-dlp search
    console.log(`[YouTube] Using yt-dlp fallback search for: ${query}`);
    const proc = Bun.spawn(
      [
        "yt-dlp",
        "-4",
        `ytsearch5:${query}`,
        "--dump-json",
        "--no-playlist",
        "--no-warnings",
        "--default-search",
        "ytsearch",
        ...this.getExtractorArgs(),
      ],
      { stdout: "pipe", stderr: "pipe" }
    );

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0 && stdout.trim().length === 0) {
      console.error(`[YouTube] Search failed (exit ${exitCode}): ${stderr.trim()}`);
      return [];
    }

    const lines = stdout.trim().split("\n");
    const tracks: TrackType[] = [];

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as YtDlpJsonOutput;
        if (!parsed.id) continue;

        tracks.push({
          id: parsed.id,
          title: parsed.title ?? parsed.fulltitle ?? "YouTube Track",
          duration: parsed.duration ?? 0,
          parental_warning: false,
          track_number: 1,
          performer: {
            name: parsed.uploader ?? "YouTube",
            id: 0,
          },
          album: {
            title: "YouTube",
            id: "0",
            duration: parsed.duration ?? 0,
            parental_warning: false,
            release_date_original: new Date().toISOString(),
            image: {
              thumbnail: `https://i.ytimg.com/vi/${parsed.id}/hqdefault.jpg`,
              small: `https://i.ytimg.com/vi/${parsed.id}/hqdefault.jpg`,
              large: `https://i.ytimg.com/vi/${parsed.id}/maxresdefault.jpg`,
            },
          },
        });
      } catch (err) {
        console.error("[YouTube] Failed to parse yt-dlp search result line:", err);
      }
    }

    if (tracks.length > 0 && typeof tracks[0].id === "string") {
      void this.getStreamInfo(tracks[0].id).catch(() => undefined);
    }

    return tracks;
  }

  /**
   * YouTube Music's radio for a video: more from the same artist plus songs with a similar
   * mood and genre (a ghazal leads to more ghazals). Excludes the seed video itself.
   */
  async getSuggestions(videoId: string): Promise<TrackType[]> {
    const yt = await this.getInnertube();
    const panel = await yt.music.getUpNext(videoId, true);
    const tracks: TrackType[] = [];

    for (const item of panel.contents) {
      // shortcut: skips PlaylistPanelVideoWrapper entries (alternate versions); unwrap `primary` if radios come back thin.
      const record = asRecord(item);
      if (!record) continue;
      const id = record.video_id;
      if (typeof id !== "string" || id === videoId) continue;

      const artists = Array.isArray(record.artists) ? (record.artists as unknown[]) : [];
      const author = readText(artists[0], "name") ?? readText(record.author, "name") ?? "YouTube";
      const seconds = asRecord(record.duration)?.seconds;
      const title = readText(record.title, "text") ?? "YouTube Track";
      tracks.push(toYoutubeTrack(id, title, author, typeof seconds === "number" ? seconds : 0));
    }

    return tracks.slice(0, MAX_SUGGESTIONS);
  }
}

export const YOUTUBE_MANAGER = new YoutubeManager();
