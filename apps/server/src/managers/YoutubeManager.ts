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
}

export interface PipedAudioStream {
  stream: ReadableStream<Uint8Array>;
  kill: () => void;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

const readText = (value: unknown, nestedKey: string): string | undefined => {
  if (typeof value === "string") return value;
  const record = asRecord(value);
  const nested = record?.[nestedKey];
  return typeof nested === "string" ? nested : undefined;
};

const COOKIES_FILE = path.join(process.cwd(), "cookies.txt");
const STREAM_PATH_PREFIX = "/stream/youtube";
const STREAM_CACHE_TTL_MS = 2 * 60 * 60 * 1000;
const RANGE_VALIDATION_CHUNK_SIZE = 1024 * 1024;
const MAX_TITLE_LENGTH = 120;
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export class YoutubeManager {
  private innertube: Innertube | null = null;
  private streamInnertubePromise: Promise<Innertube> | null = null;
  private streamCache = new Map<string, YoutubeStreamInfo>();
  private streamJobs = new Map<string, Promise<YoutubeStreamInfo>>();

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
    const playerClient = configuredClient?.length ? configuredClient : "mweb";
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

  private async isFullyRangeable(url: string, contentLength: number): Promise<boolean> {
    const offsets = [0];
    if (contentLength > RANGE_VALIDATION_CHUNK_SIZE) {
      offsets.push(RANGE_VALIDATION_CHUNK_SIZE);
      offsets.push(contentLength - 1024);
    }

    const results = await Promise.all(
      offsets.map(async (offset) => {
        try {
          const end = contentLength > 0 ? Math.min(offset + 1023, contentLength - 1) : offset + 1023;
          const response = await fetch(url, {
            headers: { Range: `bytes=${offset}-${end}` },
            signal: AbortSignal.timeout(5000),
          });
          const body = await response.arrayBuffer();
          return (response.status === 206 || response.status === 200) && body.byteLength > 0;
        } catch {
          return false;
        }
      })
    );

    return results.every(Boolean);
  }

  /** Streams yt-dlp's stdout directly to the caller, without touching disk or R2. */
  createPipedAudioStream(videoId: string, mimeType: string): PipedAudioStream {
    const extension = mimeType.startsWith("audio/webm") ? "webm" : "m4a";
    const args = [
      "yt-dlp",
      "-o",
      "-",
      "-f",
      `bestaudio[ext=${extension}][abr<=160]/bestaudio[ext=${extension}]/bestaudio`,
      "--no-playlist",
      "--no-warnings",
      "--no-progress",
      "--extractor-args",
      "youtube:player_client=mweb",
    ];
    if (fs.existsSync(COOKIES_FILE)) args.push("--cookies", COOKIES_FILE);
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
    };
  }

  private async resolveStreamInfo(videoId: string): Promise<YoutubeStreamInfo> {
    const yt = await this.getStreamInnertube();
    const info = await yt.getBasicInfo(videoId);

    if (info.playability_status?.status && info.playability_status.status !== "OK") {
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

    // Some iOS-client URLs only serve their first ~1 MiB and then return 403.
    // Those videos stream through yt-dlp's stdout instead of the range proxy.
    const mode = (await this.isFullyRangeable(streamUrl, contentLength)) ? "proxy" : "pipe";
    if (mode === "pipe") {
      console.warn(`[YouTube] Stream for ${videoId} is range-limited; using yt-dlp pipe fallback`);
    }

    const expireMs = Number(parsedUrl.searchParams.get("expire")) * 1000;
    const expiresAt =
      mode === "proxy" && Number.isFinite(expireMs) && expireMs > 0
        ? Math.min(expireMs - 5 * 60 * 1000, Date.now() + STREAM_CACHE_TTL_MS)
        : Date.now() + STREAM_CACHE_TTL_MS;

    return {
      url: streamUrl,
      mimeType,
      contentLength,
      title: title?.length ? title : "YouTube Track",
      expiresAt,
      mode,
    };
  }

  async getStreamInfo(videoId: string, options: { force?: boolean } = {}): Promise<YoutubeStreamInfo> {
    if (!VIDEO_ID_PATTERN.test(videoId)) throw new Error(`Invalid YouTube video ID: ${videoId}`);

    if (options.force) this.streamCache.delete(videoId);

    const cached = this.streamCache.get(videoId);
    if (cached && cached.expiresAt > Date.now()) return cached;

    const existingJob = this.streamJobs.get(videoId);
    if (existingJob) return existingJob;

    const job = this.resolveStreamInfo(videoId)
      .then((info) => {
        this.streamCache.set(videoId, info);
        return info;
      })
      .finally(() => {
        this.streamJobs.delete(videoId);
      });

    this.streamJobs.set(videoId, job);
    return job;
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
