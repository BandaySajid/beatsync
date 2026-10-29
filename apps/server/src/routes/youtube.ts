import { IS_DEMO_MODE } from "@/demo";
import { YOUTUBE_MANAGER, type YoutubeStreamInfo } from "@/managers/YoutubeManager";
import { corsHeaders, errorResponse } from "@/utils/responses";

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const RETRYABLE_UPSTREAM_STATUSES = new Set([403, 410]);
const UPSTREAM_HEADER_TIMEOUT_MS = 12_000;
const MAX_UPSTREAM_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 250;
// googlevideo throttles long-lived single connections hard (tens of KB/s),
// while independent Range requests run at full speed. Splitting into 1 MiB
// ranges and keeping a few in flight turns a multi-minute download into a few
// seconds. Responses are still emitted strictly in order.
const CHUNK_SIZE = 1024 * 1024;
const MAX_PARALLEL_CHUNKS = 4;
// Upstream 200s are sliced locally, so responses that ignore Range stay correct.
const FORWARDED_RESPONSE_HEADERS = ["content-type", "accept-ranges", "etag", "last-modified"];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface ByteRange {
  start: number;
  end: number;
}

interface UpstreamResult {
  info: YoutubeStreamInfo;
  response: Response;
}

function parseByteRange(range: string, totalBytes: number): ByteRange | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!match) return null;

  const start = match[1];
  const end = match[2];

  if (!start && end) {
    if (totalBytes <= 0) return null;
    const suffixLength = Number(end);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
    return { start: Math.max(0, totalBytes - suffixLength), end: totalBytes - 1 };
  }

  if (!start) return null;

  const startByte = Number(start);
  if (!Number.isFinite(startByte)) return null;

  let endByte = end ? Number(end) : totalBytes > 0 ? totalBytes - 1 : NaN;
  if (!Number.isFinite(endByte)) return null;
  if (totalBytes > 0) endByte = Math.min(endByte, totalBytes - 1);

  return startByte <= endByte ? { start: startByte, end: endByte } : null;
}

function getTotalFromResponse(response: Response, fallback: number): number {
  const match = /\/(\d+)$/.exec(response.headers.get("content-range") ?? "");
  return match ? Number(match[1]) : fallback;
}

function buildUpstreamHeaders(info?: YoutubeStreamInfo, range?: ByteRange): Headers {
  const userAgent =
    info?.userAgent ??
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";
  const headers = new Headers({
    "User-Agent": userAgent,
    Referer: "https://www.youtube.com/",
  });
  if (range) headers.set("Range", `bytes=${range.start}-${range.end}`);
  return headers;
}

/**
 * Fetch from googlevideo, refreshing the resolved URL when it has expired
 * (403/410) or the connection failed. Header acquisition is bounded; the body
 * itself is not, so long tracks are never cut off by a timeout.
 */
async function requestUpstream({
  videoId,
  info,
  range,
  method,
  signal,
}: {
  videoId: string;
  info: YoutubeStreamInfo;
  range?: ByteRange;
  method: string;
  signal: AbortSignal;
}): Promise<UpstreamResult> {
  let currentInfo = info;
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_UPSTREAM_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const abortUpstream = () => controller.abort(signal.reason);
    if (signal.aborted) throw signal.reason ?? new Error("Request aborted");
    signal.addEventListener("abort", abortUpstream, { once: true });

    const headerTimeout = setTimeout(() => {
      controller.abort(new Error("YouTube upstream header timeout"));
    }, UPSTREAM_HEADER_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(currentInfo.url, {
        method,
        headers: buildUpstreamHeaders(currentInfo, range),
        redirect: "follow",
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(headerTimeout);
      signal.removeEventListener("abort", abortUpstream);
      if (signal.aborted) throw error;

      lastError = error;
      console.warn(
        `[YouTube] Upstream fetch failed for ${videoId} (attempt ${attempt}/${MAX_UPSTREAM_ATTEMPTS}):`,
        error
      );
      if (attempt < MAX_UPSTREAM_ATTEMPTS) {
        currentInfo = await YOUTUBE_MANAGER.getStreamInfo(videoId, { force: true }).catch(() => currentInfo);
        await sleep(RETRY_BACKOFF_MS * attempt);
        continue;
      }
      throw error;
    }

    clearTimeout(headerTimeout);

    const retryable = RETRYABLE_UPSTREAM_STATUSES.has(response.status) || response.status >= 500;
    if (retryable && attempt < MAX_UPSTREAM_ATTEMPTS) {
      await response.body?.cancel().catch(() => undefined);
      signal.removeEventListener("abort", abortUpstream);
      console.warn(
        `[YouTube] Upstream returned ${response.status} for ${videoId} (attempt ${attempt}/${MAX_UPSTREAM_ATTEMPTS})`
      );

      if (RETRYABLE_UPSTREAM_STATUSES.has(response.status)) {
        currentInfo = await YOUTUBE_MANAGER.getStreamInfo(videoId, { force: true }).catch(() => currentInfo);
      }
      await sleep(RETRY_BACKOFF_MS * attempt);
      continue;
    }

    // Keep the abort listener attached for the body's lifetime so a client
    // disconnect tears down the upstream connection too.
    return { info: currentInfo, response };
  }

  throw lastError instanceof Error ? lastError : new Error("Failed to reach YouTube upstream");
}

function baseResponseHeaders(info: YoutubeStreamInfo): Headers {
  return new Headers({
    ...corsHeaders,
    "Content-Type": info.mimeType,
    "Accept-Ranges": "bytes",
    "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, Content-Type, X-Audio-Length",
    "Cache-Control": "public, max-age=3600",
  });
}

/** Slice an ignored-Range (200) body down to the requested byte range. */
function sliceBody(body: ReadableStream<Uint8Array> | null, range: ByteRange): ReadableStream<Uint8Array> {
  if (!body) {
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });
  }

  const reader = body.getReader();
  let offset = 0;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        if (!value || value.byteLength === 0) continue;

        const chunkStart = offset;
        offset += value.byteLength;

        if (offset <= range.start) continue;

        const skip = Math.max(0, range.start - chunkStart);
        const take = Math.min(value.byteLength, range.end - chunkStart + 1);
        if (take <= skip) {
          await reader.cancel().catch(() => undefined);
          controller.close();
          return;
        }

        controller.enqueue(skip > 0 ? value.subarray(skip, take) : value.subarray(0, take));

        if (chunkStart + take - 1 >= range.end) {
          await reader.cancel().catch(() => undefined);
          controller.close();
          return;
        }
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

function copyForwardedHeaders(headers: Headers, response: Response): void {
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = response.headers.get(name);
    if (value) headers.set(name, value);
  }
}

async function rejectBadUpstream(videoId: string, response: Response, headers: Headers): Promise<Response | null> {
  if (response.status === 416) {
    await response.body?.cancel();
    return new Response(null, { status: 416, headers });
  }
  if (response.status !== 206 && response.status !== 200) {
    await response.body?.cancel();
    console.error(`[YouTube] Upstream returned ${response.status} for ${videoId}`);
    return errorResponse("Failed to stream YouTube audio", response.status === 404 ? 404 : 502);
  }
  return null;
}

/**
 * Emit an ordered byte range by fetching it as parallel 1 MiB ranges. The first
 * chunk is passed in already open; the rest are prefetched a few at a time.
 * googlevideo throttles a single long connection but serves independent ranges
 * at full speed, so this is the difference between ~30 KB/s and several MB/s.
 */
function createChunkedBody({
  videoId,
  info,
  firstResponse,
  firstRange,
  finalEnd,
  signal,
}: {
  videoId: string;
  info: YoutubeStreamInfo;
  firstResponse: Response;
  firstRange: ByteRange;
  finalEnd: number;
  signal: AbortSignal;
}): ReadableStream<Uint8Array> {
  const ranges: ByteRange[] = [];
  for (let start = firstRange.end + 1; start <= finalEnd; start += CHUNK_SIZE) {
    ranges.push({ start, end: Math.min(start + CHUNK_SIZE - 1, finalEnd) });
  }

  const totalChunks = ranges.length + 1;
  const responses = new Map<number, Promise<Response>>();
  responses.set(0, Promise.resolve(firstResponse));
  let nextToStart = 1;
  let nextToRead = 0;
  let sharedInfo = info;

  const startChunk = (index: number) => {
    if (index >= totalChunks || responses.has(index)) return;
    const range = ranges[index - 1];

    const promise = requestUpstream({ videoId, info: sharedInfo, range, method: "GET", signal }).then(
      ({ info: refreshedInfo, response }) => {
        sharedInfo = refreshedInfo;
        if (response.status !== 206) {
          void response.body?.cancel();
          throw new Error(`YouTube chunk ${range.start}-${range.end} failed with status ${response.status}`);
        }
        return response;
      }
    );
    promise.catch(() => undefined);

    responses.set(index, promise);
  };

  const fill = () => {
    while (nextToStart < totalChunks && nextToStart < nextToRead + MAX_PARALLEL_CHUNKS) {
      startChunk(nextToStart++);
    }
  };

  const cancelInFlight = () => {
    for (const promise of responses.values()) {
      void promise.then((response) => response.body?.cancel()).catch(() => undefined);
    }
    responses.clear();
  };

  return new ReadableStream<Uint8Array>({
    start() {
      fill();
    },
    async pull(controller) {
      const task = responses.get(nextToRead);
      if (!task) {
        controller.close();
        return;
      }

      let response: Response;
      try {
        response = await task;
      } catch (error) {
        cancelInFlight();
        throw error;
      }

      responses.delete(nextToRead);
      nextToRead++;

      const reader = response.body?.getReader();
      if (reader) {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value && value.byteLength > 0) controller.enqueue(value);
          }
        } catch (error) {
          cancelInFlight();
          throw error;
        } finally {
          reader.releaseLock();
        }
      }

      fill();

      if (nextToRead >= totalChunks) {
        controller.close();
      }
    },
    cancel() {
      cancelInFlight();
    },
  });
}

function handlePipedAudio(videoId: string, info: YoutubeStreamInfo, req: Request): Response {
  const headers = baseResponseHeaders(info);
  headers.delete("Content-Length");
  headers.set("Accept-Ranges", "none");

  if (req.method === "HEAD") return new Response(null, { status: 200, headers });
  if (req.signal.aborted) return errorResponse("Request aborted", 499);

  const piped = YOUTUBE_MANAGER.createPipedAudioStream(videoId, info.mimeType);
  req.signal.addEventListener("abort", piped.kill, { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = piped.stream.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value && value.byteLength > 0) controller.enqueue(value);
        }

        const exitCode = await piped.exited;
        if (exitCode !== 0) {
          throw new Error(`yt-dlp exited with code ${exitCode}`);
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      } finally {
        reader.releaseLock();
      }
    },
    cancel() {
      piped.kill();
    },
  });

  return new Response(stream, { status: 200, headers });
}

async function handleFullAudio(videoId: string, info: YoutubeStreamInfo, req: Request): Promise<Response> {
  const knownTotal = info.contentLength;

  if (knownTotal <= 0) {
    const upstream = await requestUpstream({ videoId, info, method: req.method, signal: req.signal });
    const headers = baseResponseHeaders(upstream.info);
    const rejected = await rejectBadUpstream(videoId, upstream.response, headers);
    if (rejected) return rejected;

    const totalBytes = getTotalFromResponse(upstream.response, knownTotal);
    const contentLength = Number(upstream.response.headers.get("content-length") ?? totalBytes);
    if (contentLength > 0) {
      headers.set("Content-Length", String(contentLength));
      headers.set("X-Audio-Length", String(contentLength));
    }

    if (req.method === "HEAD") {
      await upstream.response.body?.cancel();
      return new Response(null, { status: 200, headers });
    }
    return new Response(upstream.response.body, { status: 200, headers });
  }

  const firstRange: ByteRange = { start: 0, end: Math.min(CHUNK_SIZE - 1, knownTotal - 1) };
  const first = await requestUpstream({ videoId, info, range: firstRange, method: req.method, signal: req.signal });
  const response = first.response;
  const headers = baseResponseHeaders(first.info);

  const rejected = await rejectBadUpstream(videoId, response, headers);
  if (rejected) return rejected;

  const totalBytes = getTotalFromResponse(response, knownTotal);
  if (totalBytes > 0) {
    headers.set("Content-Length", String(totalBytes));
    headers.set("X-Audio-Length", String(totalBytes));
  }

  if (req.method === "HEAD") {
    await response.body?.cancel();
    return new Response(null, { status: 200, headers });
  }

  if (response.status === 200) {
    copyForwardedHeaders(headers, response);
    return new Response(response.body, { status: 200, headers });
  }

  copyForwardedHeaders(headers, response);

  if (firstRange.end >= totalBytes - 1) {
    return new Response(response.body, { status: 200, headers });
  }

  return new Response(
    createChunkedBody({
      videoId,
      info: first.info,
      firstResponse: response,
      firstRange,
      finalEnd: totalBytes - 1,
      signal: req.signal,
    }),
    { status: 200, headers }
  );
}

async function handleRangeAudio(
  videoId: string,
  info: YoutubeStreamInfo,
  req: Request,
  range: ByteRange
): Promise<Response> {
  const knownTotal = info.contentLength;
  const rangeLength = range.end - range.start + 1;

  if (knownTotal <= 0) {
    const upstream = await requestUpstream({ videoId, info, range, method: req.method, signal: req.signal });
    const headers = baseResponseHeaders(upstream.info);
    const rejected = await rejectBadUpstream(videoId, upstream.response, headers);
    if (rejected) return rejected;

    const totalBytes = getTotalFromResponse(upstream.response, knownTotal);
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${totalBytes || "*"}`);
    headers.set("Content-Length", String(rangeLength));
    if (totalBytes > 0) headers.set("X-Audio-Length", String(totalBytes));

    if (req.method === "HEAD") {
      await upstream.response.body?.cancel();
      return new Response(null, { status: 206, headers });
    }

    copyForwardedHeaders(headers, upstream.response);
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${totalBytes || "*"}`);
    headers.set("Content-Length", String(rangeLength));

    if (upstream.response.status === 200) {
      return new Response(sliceBody(upstream.response.body, range), { status: 206, headers });
    }
    return new Response(upstream.response.body, { status: 206, headers });
  }

  const firstRange: ByteRange = {
    start: range.start,
    end: Math.min(range.start + CHUNK_SIZE - 1, range.end),
  };
  const first = await requestUpstream({ videoId, info, range: firstRange, method: req.method, signal: req.signal });
  const response = first.response;
  const headers = baseResponseHeaders(first.info);

  const rejected = await rejectBadUpstream(videoId, response, headers);
  if (rejected) return rejected;

  const totalBytes = getTotalFromResponse(response, knownTotal);
  headers.set("Content-Range", `bytes ${range.start}-${range.end}/${totalBytes || "*"}`);
  headers.set("Content-Length", String(rangeLength));
  if (totalBytes > 0) headers.set("X-Audio-Length", String(totalBytes));

  if (req.method === "HEAD") {
    await response.body?.cancel();
    return new Response(null, { status: 206, headers });
  }

  copyForwardedHeaders(headers, response);
  headers.set("Content-Range", `bytes ${range.start}-${range.end}/${totalBytes || "*"}`);
  headers.set("Content-Length", String(rangeLength));

  if (response.status === 200) {
    return new Response(sliceBody(response.body, range), { status: 206, headers });
  }

  if (firstRange.end >= range.end) {
    return new Response(response.body, { status: 206, headers });
  }

  return new Response(
    createChunkedBody({
      videoId,
      info: first.info,
      firstResponse: response,
      firstRange,
      finalEnd: range.end,
      signal: req.signal,
    }),
    { status: 206, headers }
  );
}

/** Serve a preloaded file from disk, honoring Range and HEAD. */
function serveCachedFile(cachePath: string, req: Request): Response {
  const file = Bun.file(cachePath);
  const totalSize = file.size;
  const headers = new Headers({
    ...corsHeaders,
    "Content-Type": "audio/mp4",
    "Accept-Ranges": "bytes",
    "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, Content-Type, X-Audio-Length",
    "Cache-Control": "public, max-age=86400",
    "X-Audio-Length": String(totalSize),
  });

  const rangeHeader = req.headers.get("range");
  if (rangeHeader) {
    const range = parseByteRange(rangeHeader, totalSize);
    if (!range) return errorResponse("Invalid Range header", 416);

    const length = range.end - range.start + 1;
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${totalSize}`);
    headers.set("Content-Length", String(length));

    if (req.method === "HEAD") return new Response(null, { status: 206, headers });
    return new Response(file.slice(range.start, range.end + 1), { status: 206, headers });
  }

  headers.set("Content-Length", String(totalSize));
  if (req.method === "HEAD") return new Response(null, { status: 200, headers });
  return new Response(file, { status: 200, headers });
}

export async function handleYoutubeAudio(videoId: string, req: Request): Promise<Response> {
  if (IS_DEMO_MODE) return errorResponse("Not found", 404);
  if (!VIDEO_ID_PATTERN.test(videoId)) return errorResponse("Invalid YouTube video ID", 400);
  if (req.method !== "GET" && req.method !== "HEAD") return errorResponse("Method not allowed", 405);

  try {
    // 1. Already cached on local disk: serve immediately with native range support.
    if (YOUTUBE_MANAGER.isCached(videoId)) {
      return serveCachedFile(YOUTUBE_MANAGER.getCacheFilePath(videoId), req);
    }

    const info = await YOUTUBE_MANAGER.getStreamInfo(videoId);
    if (info.mode === "pipe") return handlePipedAudio(videoId, info, req);

    const rangeHeader = req.headers.get("range");

    // 2. Full track: stream immediately. The client's completion message warms
    // the disk cache, so the first play never competes with a second download.
    if (!rangeHeader) {
      return await handleFullAudio(videoId, info, req);
    }

    const range = parseByteRange(rangeHeader, info.contentLength);
    if (!range) return errorResponse("Invalid Range header", 416);

    return await handleRangeAudio(videoId, info, req, range);
  } catch (error) {
    console.error(`[YouTube] Stream proxy failed for ${videoId}:`, error);
    return errorResponse("Failed to stream YouTube audio", 502);
  }
}
