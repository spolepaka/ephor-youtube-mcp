import express, { Request, Response } from 'express';
import { z } from 'zod';
import * as cheerio from 'cheerio';

// Define interfaces for responses (copied from index.ts)
interface VideoResult {
  videoId: string;
  title: string;
  url: string;
  thumbnailUrl: string;
  description: string;
  channel: {
    name: string;
    url: string;
  };
  viewCount?: string;
  publishedTime?: string;
}

// Common headers for requests (copied from index.ts)
const commonHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
  'Sec-Fetch-Site': 'same-origin',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-User': '?1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Ch-Ua': '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Upgrade-Insecure-Requests': '1',
  'Cache-Control': 'max-age=0',
};

// Initialize Express app
const app = express();
app.use(express.json());

// Helper function to extract video ID from URL (copied from index.ts)
function extractVideoId(input: string): string | null {
  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) {
    return input;
  }
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([^"&?\/\s]{11})/,
    /(?:youtu\.be\/)([^"&?\/\s]{11})/,
    /(?:youtube\.com\/embed\/)([^"&?\/\s]{11})/,
    /(?:youtu\.be\/|youtube\.com\/watch\?v=)([^"&?\/\s]{11})/,
    /(?:m\.youtube\.com\/watch\?v=)([^"&?\/\s]{11})/,
    /(?:music\.youtube\.com\/watch\?v=)([^"&?\/\s]{11})/,
  ];
  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  return null;
}

// Helper function to extract initial data from YouTube page (copied from index.ts)
function extractInitialData(html: string): any {
  try {
    const ytInitialDataMatch = html.match(/var ytInitialData = ({.*?});/);
    if (ytInitialDataMatch && ytInitialDataMatch[1]) {
      return JSON.parse(ytInitialDataMatch[1]);
    }
    return null;
  } catch (error) {
    console.error('Error parsing initial data:', error);
    return null;
  }
}

// Main search function (adapted from index.ts)
async function performYouTubeSearch(query: string, limit: number = 5): Promise<VideoResult[]> {
  try {
    const searchUrl = 'https://www.youtube.com/results?' + new URLSearchParams({
      search_query: query,
      sp: 'CAISAhAB',
    }).toString();

    const response = await fetch(searchUrl, {
      headers: { ...commonHeaders, 'Referer': 'https://www.youtube.com/' },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const html = await response.text();
    const initialData = extractInitialData(html);

    if (!initialData) {
      throw new Error('Could not extract video data from page');
    }

    const results: VideoResult[] = [];
    const items = initialData.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents || [];

    for (const item of items) {
      if (results.length >= limit) break;
      const videoRenderer = item.videoRenderer;
      if (!videoRenderer) continue;

      const result: VideoResult = {
        videoId: videoRenderer.videoId,
        title: videoRenderer.title?.runs?.[0]?.text || '',
        url: `https://youtube.com/watch?v=${videoRenderer.videoId}`,
        thumbnailUrl: videoRenderer.thumbnail?.thumbnails?.[0]?.url || '',
        description: videoRenderer.descriptionSnippet?.runs?.[0]?.text || '',
        channel: {
          name: videoRenderer.ownerText?.runs?.[0]?.text || '',
          url: `https://youtube.com${videoRenderer.ownerText?.runs?.[0]?.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url || ''}`,
        },
        viewCount: videoRenderer.viewCountText?.simpleText || '',
        publishedTime: videoRenderer.publishedTimeText?.simpleText || '',
      };

      if (result.videoId && result.title) {
        results.push(result);
      }
    }

    return results;
  } catch (error) {
    throw new Error(`Failed to perform YouTube search: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// Helper function to extract transcript data (copied from index.ts)
async function extractTranscript(videoId: string): Promise<{ transcript: any[]; videoInfo: any }> {
  try {
    const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: { ...commonHeaders, 'Referer': 'https://www.youtube.com/results' },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const html = await response.text();
    const playerResponseMatch = html.match(/ytInitialPlayerResponse\s*=\s*({.+?});/);
    if (!playerResponseMatch) {
      throw new Error('Could not find player response data');
    }

    const playerResponse = JSON.parse(playerResponseMatch[1]);
    const captions = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

    if (!captions || captions.length === 0) {
      throw new Error('No transcript available for this video');
    }

    const captionTrack = captions.find((track: any) => track.languageCode === 'en') || captions[0];
    if (!captionTrack?.baseUrl) {
      throw new Error('Could not find caption track URL');
    }

    const transcriptResponse = await fetch(captionTrack.baseUrl + '&fmt=json3');
    if (!transcriptResponse.ok) {
      throw new Error('Failed to fetch transcript');
    }

    const transcriptData = await transcriptResponse.json();
    const transcriptEvents = transcriptData.events || [];

    const processedTranscript = transcriptEvents
      .filter((event: any) => event.segs)
      .map((event: any) => {
        const startTime = event.tStartMs / 1000;
        const text = event.segs.map((seg: any) => seg.utf8).join(' ').trim();
        return { time: startTime.toFixed(2), text };
      });

    const videoInfo = {
      title: playerResponse.videoDetails?.title || '',
      channel: { name: playerResponse.videoDetails?.author || '' },
      duration: playerResponse.videoDetails?.lengthSeconds || '',
    };

    return { transcript: processedTranscript, videoInfo };
  } catch (error) {
    throw error;
  }
}

// SSE endpoint for 'search' tool
app.get('/tools/search', async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const schema = z.object({
    query: z.string().min(1),
    limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().min(1).max(10)).optional().default('5'),
  });

  try {
    const { query, limit } = schema.parse(req.query);
    const results = await performYouTubeSearch(query, limit);
    res.write(`data: ${JSON.stringify(results.length > 0 ? results : { message: 'No results found' })}\n\n`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.write(`data: ${JSON.stringify({ error: `Error performing search: ${errorMessage}` })}\n\n`);
  } finally {
    res.end();
  }
});

// SSE endpoint for 'get-video-info' tool
app.get('/tools/get-video-info', async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const schema = z.object({
    input: z.string().min(1).describe('YouTube video ID or URL'),
  });

  try {
    const { input } = schema.parse(req.query);
    const videoId = extractVideoId(input);

    if (!videoId) {
      res.write(`data: ${JSON.stringify({ error: `Invalid YouTube video ID or URL: ${input}` })}\n\n`);
      res.end();
      return;
    }

    const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: { ...commonHeaders, 'Referer': 'https://www.youtube.com/results' },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const html = await response.text();
    const initialData = extractInitialData(html);

    if (!initialData) {
      throw new Error('Could not extract video data from page');
    }

    const videoData = initialData.contents?.twoColumnWatchNextResults?.results?.results?.contents?.[0]?.videoPrimaryInfoRenderer;
    const channelData = initialData.contents?.twoColumnWatchNextResults?.results?.results?.contents?.[1]?.videoSecondaryInfoRenderer;

    if (!videoData) {
      throw new Error('Could not find video data');
    }

    const result = {
      videoId,
      title: videoData.title?.runs?.[0]?.text || '',
      description: channelData?.description?.runs?.map((run: any) => run.text).join('') || '',
      viewCount: videoData.viewCount?.videoViewCountRenderer?.viewCount?.simpleText || '',
      publishDate: videoData.dateText?.simpleText || '',
      channel: {
        name: channelData?.owner?.videoOwnerRenderer?.title?.runs?.[0]?.text || '',
        url: channelData?.owner?.videoOwnerRenderer?.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url || '',
      },
      thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      url: `https://youtube.com/watch?v=${videoId}`,
    };

    res.write(`data: ${JSON.stringify(result)}\n\n`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.write(`data: ${JSON.stringify({ error: `Error fetching video info: ${errorMessage}` })}\n\n`);
  } finally {
    res.end();
  }
});

// SSE endpoint for 'get-transcript' tool
app.get('/tools/get-transcript', async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const schema = z.object({
    input: z.string().min(1).describe('YouTube video ID or URL'),
  });

  try {
    const { input } = schema.parse(req.query);
    const videoId = extractVideoId(input);

    if (!videoId) {
      res.write(`data: ${JSON.stringify({ error: `Invalid YouTube video ID or URL: ${input}` })}\n\n`);
      res.end();
      return;
    }

    const { transcript, videoInfo } = await extractTranscript(videoId);
    const result = { videoId, videoInfo, transcript };

    res.write(`data: ${JSON.stringify(result)}\n\n`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.write(`data: ${JSON.stringify({ error: `Error fetching transcript: ${errorMessage}` })}\n\n`);
  } finally {
    res.end();
  }
});

// Start the server
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`SSE YouTube Server running on http://localhost:${PORT}`);
  console.log('Endpoints:');
  console.log('  - Search: /tools/search?query=<query>&limit=<number>');
  console.log('  - Video Info: /tools/get-video-info?input=<video_id_or_url>');
  console.log('  - Transcript: /tools/get-transcript?input=<video_id_or_url>');
});