import { IS_DEMO_MODE } from "@/demo";
import { YOUTUBE_MANAGER, type YoutubeStreamInfo } from "@/managers/YoutubeManager";
import { corsHeaders, errorResponse } from "@/utils/responses";

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const RETRYABLE_UPSTREAM_STATUSES = new Set([403, 410]);
const CHUNK_SIZE = 1024 * 1024;
const FORWARDED_RESPONSE_HEADERS = ["content-type", "content-range", "accept-ranges", "etag", "last-modified"];

interface ByteRange {
  start: number;
  end: number;
}

interface ChunkResult {
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

function buildUpstreamHeaders(range: ByteRange): Headers {
  return new Headers({
    "User-Agent":
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    Referer: "https://www.youtube.com/",
    Range: `bytes=${range.start}-${range.end}`,
  });
}

async function requestChunk(
  videoId: string,
  info: YoutubeStreamInfo,
  range: ByteRange,
  method: string,
  signal: AbortSignal
): Promise<ChunkResult> {
  let currentInfo = info;
  let response = await fetch(currentInfo.url, {
    method,
    headers: buildUpstreamHeaders(range),
    redirect: "follow",
    signal,
  });

  if (RETRYABLE_UPSTREAM_STATUSES.has(response.status)) {
    await response.body?.cancel();
    currentInfo = await YOUTUBE_MANAGER.getStreamInfo(videoId, { force: true });
    response = await fetch(currentInfo.url, {
      method,
      headers: buildUpstreamHeaders(range),
      redirect: "follow",
      signal,
    });
  }

  return { info: currentInfo, response };
}

async function pipeChunk(response: Response, controller: ReadableStreamDefaultController<Uint8Array>) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("YouTube returned an empty stream body");

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) controller.enqueue(value);
    }
  } finally {
    reader.releaseLock();
  }
}

function createChunkedStream({
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
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        let currentInfo = info;
        let response = firstResponse;
        let range = firstRange;

        for (;;) {
          await pipeChunk(response, controller);

          if (range.end >= finalEnd) break;

          range = {
            start: range.end + 1,
            end: Math.min(range.end + CHUNK_SIZE, finalEnd),
          };

          const next = await requestChunk(videoId, currentInfo, range, "GET", signal);
          currentInfo = next.info;
          response = next.response;

          if (response.status !== 206 && response.status !== 200) {
            throw new Error(`YouTube chunk request failed with status ${response.status}`);
          }
        }

        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

function baseResponseHeaders(info: YoutubeStreamInfo): Headers {
  return new Headers({
    ...corsHeaders,
    "Content-Type": info.mimeType,
    "Accept-Ranges": "bytes",
    "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, Content-Type",
    "Cache-Control": "public, max-age=3600",
  });
}

async function handleFullAudio(videoId: string, info: YoutubeStreamInfo, req: Request): Promise<Response> {
  let currentInfo = info;
  let totalBytes = currentInfo.contentLength;
  const firstRange: ByteRange = {
    start: 0,
    end: totalBytes > 0 ? Math.min(CHUNK_SIZE - 1, totalBytes - 1) : CHUNK_SIZE - 1,
  };
  const isHead = req.method === "HEAD";

  const first = await requestChunk(videoId, currentInfo, firstRange, req.method, req.signal);
  currentInfo = first.info;
  const response = first.response;

  if (response.status === 416) {
    return new Response(null, { status: 416, headers: baseResponseHeaders(currentInfo) });
  }
  if (response.status !== 206 && response.status !== 200) {
    await response.body?.cancel();
    console.error(`[YouTube] Upstream returned ${response.status} for ${videoId}`);
    return errorResponse("Failed to stream YouTube audio", response.status === 404 ? 404 : 502);
  }

  totalBytes = getTotalFromResponse(response, totalBytes);
  const finalEnd = totalBytes > 0 ? totalBytes - 1 : firstRange.end;
  const headers = baseResponseHeaders(currentInfo);
  if (totalBytes > 0) headers.set("Content-Length", String(totalBytes));

  if (isHead) {
    await response.body?.cancel();
    return new Response(null, { status: 200, headers });
  }

  if (firstRange.end >= finalEnd) {
    return new Response(response.body, { status: 200, headers });
  }

  return new Response(
    createChunkedStream({
      videoId,
      info: currentInfo,
      firstResponse: response,
      firstRange,
      finalEnd,
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
  let currentInfo = info;
  let totalBytes = currentInfo.contentLength;
  const finalEnd = range.end;
  const firstRange: ByteRange = {
    start: range.start,
    end: Math.min(range.start + CHUNK_SIZE - 1, finalEnd),
  };
  const isHead = req.method === "HEAD";

  const first = await requestChunk(videoId, currentInfo, firstRange, req.method, req.signal);
  currentInfo = first.info;
  const response = first.response;

  if (response.status === 416) {
    return new Response(null, { status: 416, headers: baseResponseHeaders(currentInfo) });
  }
  if (response.status !== 206 && response.status !== 200) {
    await response.body?.cancel();
    console.error(`[YouTube] Upstream returned ${response.status} for ${videoId}`);
    return errorResponse("Failed to stream YouTube audio", response.status === 404 ? 404 : 502);
  }

  totalBytes = getTotalFromResponse(response, totalBytes);
  const headers = baseResponseHeaders(currentInfo);
  headers.set("Content-Range", `bytes ${range.start}-${finalEnd}/${totalBytes || "*"}`);
  headers.set("Content-Length", String(finalEnd - range.start + 1));

  if (isHead) {
    await response.body?.cancel();
    return new Response(null, { status: 206, headers });
  }

  if (firstRange.end >= finalEnd) {
    for (const name of FORWARDED_RESPONSE_HEADERS) {
      const value = response.headers.get(name);
      if (value) headers.set(name, value);
    }
    headers.set("Content-Range", `bytes ${range.start}-${finalEnd}/${totalBytes || "*"}`);
    return new Response(response.body, { status: 206, headers });
  }

  return new Response(
    createChunkedStream({
      videoId,
      info: currentInfo,
      firstResponse: response,
      firstRange,
      finalEnd,
      signal: req.signal,
    }),
    { status: 206, headers }
  );
}

export async function handleYoutubeAudio(videoId: string, req: Request): Promise<Response> {
  if (IS_DEMO_MODE) return errorResponse("Not found", 404);
  if (!VIDEO_ID_PATTERN.test(videoId)) return errorResponse("Invalid YouTube video ID", 400);
  if (req.method !== "GET" && req.method !== "HEAD") return errorResponse("Method not allowed", 405);

  try {
    const info = await YOUTUBE_MANAGER.getStreamInfo(videoId);
    const rangeHeader = req.headers.get("range");

    if (!rangeHeader) return await handleFullAudio(videoId, info, req);

    const range = parseByteRange(rangeHeader, info.contentLength);
    if (!range) return errorResponse("Invalid Range header", 416);

    return await handleRangeAudio(videoId, info, req, range);
  } catch (error) {
    console.error(`[YouTube] Stream proxy failed for ${videoId}:`, error);
    return errorResponse("Failed to stream YouTube audio", 502);
  }
}
