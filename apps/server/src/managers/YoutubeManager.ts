import { randomUUID } from "crypto";
import { tmpdir } from "os";
import { join } from "path";
import { mkdir, unlink } from "fs/promises";
import { uploadFile, generateAudioFileName } from "@/lib/r2";
import fs from "fs";
import path from "path";
import { Innertube } from "youtubei.js";
import type { TrackType } from "@beatsync/shared";
import type { YtDlpJsonOutput } from "@/types/youtube";

const CACHE_DIR = join(tmpdir(), "beatsync_youtube_cache");
const COOKIES_FILE = path.join(process.cwd(), "cookies.txt");
const hasCookiesFile = fs.existsSync(COOKIES_FILE);

// Use cookies file if it exists (for production), otherwise fallback to browser (for dev)
const cookieArgs = hasCookiesFile ? ["--cookies", COOKIES_FILE] : ["--cookies-from-browser", "chrome"];

// Ensure cache directory exists on startup
mkdir(CACHE_DIR, { recursive: true }).catch(console.error);

export class YoutubeManager {
  private innertube: Innertube | null = null;

  private async getInnertube(): Promise<Innertube> {
    if (!this.innertube) {
      this.innertube = await Innertube.create();
    }
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

  /**
   * Runs yt-dlp to extract the title and download the full m4a audio stream
   * concurrently. Saves the stream directly to disk.
   */
  private async extractTitleAndDownload(youtubeUrl: string, id: string): Promise<{ title: string; filePath: string }> {
    const filePath = join(CACHE_DIR, `${id}.m4a`);

    const titlePromise = (async () => {
      const proc = Bun.spawn(["yt-dlp", "--dump-json", "--no-playlist", "--no-warnings", ...cookieArgs, youtubeUrl], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        throw new Error(`yt-dlp metadata extraction failed (exit ${exitCode}): ${stderr.trim()}`);
      }
      try {
        const parsed = JSON.parse(stdout.trim()) as YtDlpJsonOutput;
        return parsed.title ?? "YouTube Track";
      } catch {
        return "YouTube Track";
      }
    })();

    const downloadPromise = (async () => {
      const proc = Bun.spawn(
        [
          "yt-dlp",
          "-o",
          filePath,
          "-f",
          "bestaudio[ext=m4a]/bestaudio/best",
          "--no-playlist",
          "--no-warnings",
          ...cookieArgs,
          youtubeUrl,
        ],
        { stdout: "pipe", stderr: "pipe" }
      );

      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        throw new Error(`yt-dlp audio download failed (exit ${exitCode}): ${stderr.trim()}`);
      }
      return filePath;
    })();

    const [title] = await Promise.all([titlePromise, downloadPromise]);
    return { title, filePath };
  }

  /**
   * Extracts audio info & downloads it for a YouTube URL, uploads it directly to R2,
   * cleans up the local cache, and returns the R2 public URL.
   */
  async addStreamAndUpload(youtubeUrl: string, roomId: string): Promise<{ publicUrl: string; title: string }> {
    console.log(`[YouTube] Downloading & extracting stream for: ${youtubeUrl}`);
    const id = randomUUID();

    // 1. Download to local disk cache
    const { title, filePath } = await this.extractTitleAndDownload(youtubeUrl, id);

    try {
      // 2. Upload to R2 (Cloudflare CDN)
      // Use standard filename generation so the UI parses the title cleanly
      const fileName = generateAudioFileName(`${title}.m4a`);

      console.log(`[YouTube] Uploading "${title}" to R2...`);
      const publicUrl = await uploadFile(filePath, roomId, fileName);
      console.log(`[YouTube] Successfully uploaded "${title}" to R2: ${publicUrl}`);

      return { publicUrl, title };
    } finally {
      // 3. Always clean up the local disk cache
      await unlink(filePath).catch((err) => {
        console.error(`[YouTube] Failed to delete local cache file ${filePath}:`, err);
      });
    }
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

      if (results && results.videos && results.videos.length > 0) {
        console.log(`[YouTube] Fast search returned ${results.videos.length} results`);
        const tracks: TrackType[] = [];

        // Take top 5
        const topVideos = results.videos.slice(0, 5);
        for (const video of topVideos) {
          const duration = video.duration?.seconds ?? 0;
          const title = typeof video.title === "string" ? video.title : (video.title?.text ?? "YouTube Video");
          const author = typeof video.author === "string" ? video.author : (video.author?.name ?? "YouTube");

          tracks.push({
            id: video.id,
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
                thumbnail: `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`,
                small: `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`,
                large: `https://i.ytimg.com/vi/${video.id}/maxresdefault.jpg`,
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
        ...cookieArgs,
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
