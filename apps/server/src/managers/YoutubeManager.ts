import { mkdir, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { copyObject, createKey, generateAudioFileName, getObjectInfo, uploadFileToKey } from "@/lib/r2";
import fs from "fs";
import path from "path";
import { Innertube } from "youtubei.js";
import type { TrackType } from "@beatsync/shared";

interface YtDlpJsonOutput {
  id?: string;
  title?: string;
  fulltitle?: string;
  duration?: number;
  uploader?: string;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

const readText = (value: unknown, nestedKey: string): string | undefined => {
  if (typeof value === "string") return value;
  const record = asRecord(value);
  const nested = record?.[nestedKey];
  return typeof nested === "string" ? nested : undefined;
};

const CACHE_DIR = join(tmpdir(), "beatsync_youtube_cache");
const COOKIES_FILE = path.join(process.cwd(), "cookies.txt");
const YOUTUBE_CACHE_PREFIX = "youtube-cache";
const AUDIO_FORMAT = "bestaudio[ext=m4a][abr<=160]/bestaudio[ext=m4a]/bestaudio[abr<=160]/bestaudio";

// Ensure cache directory exists on startup
mkdir(CACHE_DIR, { recursive: true }).catch(console.error);

export class YoutubeManager {
  private innertube: Innertube | null = null;
  private cacheJobs = new Map<string, Promise<{ cacheKey: string; title: string }>>();

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
      return videoId && /^[A-Za-z0-9_-]{11}$/.test(videoId) ? videoId : null;
    } catch {
      return null;
    }
  }

  private getCookieArgs(): string[] {
    return fs.existsSync(COOKIES_FILE) ? ["--cookies", COOKIES_FILE] : [];
  }

  private getExtractorArgs(): string[] {
    const configuredClient = process.env.YT_DLP_PLAYER_CLIENT?.trim();
    if (configuredClient === "default") return [];
    const playerClient = configuredClient?.length ? configuredClient : "mweb";
    return ["--extractor-args", `youtube:player_client=${playerClient}`];
  }

  /**
   * Runs yt-dlp to extract the title and download the full m4a audio stream
   * concurrently. Saves the stream directly to disk.
   */
  private async extractTitleAndDownload(youtubeUrl: string, videoId: string): Promise<{ title: string; filePath: string }> {
    const filePath = join(CACHE_DIR, `${videoId}.m4a`);
    const configuredConcurrency = process.env.YT_DLP_CONCURRENT_FRAGMENTS?.trim();
    const concurrentFragments = configuredConcurrency && /^\d+$/.test(configuredConcurrency) ? configuredConcurrency : "4";
    const baseArgs = [
      "yt-dlp",
      "-o",
      filePath,
      "-f",
      AUDIO_FORMAT,
      "--print",
      "after_move:%(title)s",
      "--no-playlist",
      "--no-warnings",
      "--no-progress",
      "--no-part",
      "--retries",
      "3",
      "--fragment-retries",
      "3",
      "--concurrent-fragments",
      concurrentFragments,
    ];

    // Public videos should not depend on account cookies. Retry with cookies only
    // for restricted videos, where authentication can actually be necessary.
    const primaryExtractorArgs = this.getExtractorArgs();
    const cookies = this.getCookieArgs();
    const attempts = [
      { label: "public", args: primaryExtractorArgs },
      ...(primaryExtractorArgs.length > 0
        ? [{ label: "embedded fallback", args: ["--extractor-args", "youtube:player_client=web_embedded"] }]
        : []),
      ...(cookies.length > 0 ? [{ label: "authenticated", args: [...primaryExtractorArgs, ...cookies] }] : []),
    ];
    let lastError = "unknown error";

    for (const attempt of attempts) {
      await unlink(filePath).catch(() => undefined);
      const proc = Bun.spawn([...baseArgs, ...attempt.args, youtubeUrl], { stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      if (exitCode === 0 && fs.existsSync(filePath)) {
        const outputLines = stdout.trim().split("\n");
        const extractedTitle = outputLines[outputLines.length - 1]?.trim();
        return { title: extractedTitle?.length ? extractedTitle : "YouTube Track", filePath };
      }
      lastError = stderr.trim();
      if (lastError.length === 0) lastError = `exit ${exitCode}`;
      console.warn(`[YouTube] ${attempt.label} yt-dlp attempt failed: ${lastError}`);
    }

    throw new Error(`yt-dlp audio download failed: ${lastError}`);
  }

  private async ensureCached(youtubeUrl: string, videoId: string): Promise<{ cacheKey: string; title: string }> {
    const existingJob = this.cacheJobs.get(videoId);
    if (existingJob) return existingJob;

    const job = (async () => {
      const cacheKey = `${YOUTUBE_CACHE_PREFIX}/${videoId}.m4a`;
      const cached = await getObjectInfo(cacheKey);
      if (cached.exists) {
        console.log(`[YouTube] R2 cache hit for ${videoId}`);
        let title = "YouTube Track";
        if (cached.metadata.title) {
          try {
            title = decodeURIComponent(cached.metadata.title);
          } catch {
            title = cached.metadata.title;
          }
        }
        return { cacheKey, title };
      }

      const { title, filePath } = await this.extractTitleAndDownload(youtubeUrl, videoId);
      try {
        console.log(`[YouTube] Caching "${title}" in R2...`);
        // S3 user metadata headers must be ASCII-safe.
        await uploadFileToKey(filePath, cacheKey, "audio/mp4", { title: encodeURIComponent(title) });
        return { cacheKey, title };
      } finally {
        await unlink(filePath).catch((err) => console.error(`[YouTube] Failed to delete ${filePath}:`, err));
      }
    })();

    this.cacheJobs.set(videoId, job);
    try {
      return await job;
    } finally {
      this.cacheJobs.delete(videoId);
    }
  }

  /**
   * Extracts audio info & downloads it for a YouTube URL, uploads it directly to R2,
   * cleans up the local cache, and returns the R2 public URL.
   */
  async addStreamAndUpload(youtubeUrl: string, roomId: string): Promise<{ publicUrl: string; title: string }> {
    console.log(`[YouTube] Downloading & extracting stream for: ${youtubeUrl}`);
    const videoId = YoutubeManager.getVideoId(youtubeUrl);
    if (!videoId) throw new Error("Unable to determine YouTube video ID");

    const { cacheKey, title } = await this.ensureCached(youtubeUrl, videoId);
    const fileName = generateAudioFileName(`${title}.m4a`);
    const roomKey = createKey(roomId, fileName);
    const publicUrl = await copyObject(cacheKey, roomKey);
    console.log(`[YouTube] Ready from cache "${title}": ${publicUrl}`);
    return { publicUrl, title };
  }

  /**
   * Searches YouTube for the query and returns up to 5 tracks formatted as TrackType.
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

          tracks.push({
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

        // Map yt-dlp output to TrackType
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

    return tracks;
  }
}

export const YOUTUBE_MANAGER = new YoutubeManager();
