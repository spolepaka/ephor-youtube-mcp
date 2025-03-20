import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as cheerio from 'cheerio';

// Define interfaces for our responses
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

// Create the MCP server
const server = new McpServer({
  name: "youtube-search",
  version: "1.0.0"
});

// Helper function to extract video ID from URL
function extractVideoId(input: string): string | null {
  // If input is already a valid video ID (11 characters), return it
  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) {
    return input;
  }

  // Handle various YouTube URL formats
  const patterns = [
    // Standard watch URL: https://www.youtube.com/watch?v=VIDEO_ID
    /(?:youtube\.com\/watch\?v=)([^"&?\/\s]{11})/,
    // Short URL: https://youtu.be/VIDEO_ID
    /(?:youtu\.be\/)([^"&?\/\s]{11})/,
    // Embed URL: https://www.youtube.com/embed/VIDEO_ID
    /(?:youtube\.com\/embed\/)([^"&?\/\s]{11})/,
    // Short URL with timestamp: https://youtu.be/VIDEO_ID?t=123
    /(?:youtu\.be\/|youtube\.com\/watch\?v=)([^"&?\/\s]{11})/,
    // Mobile URL: https://m.youtube.com/watch?v=VIDEO_ID
    /(?:m\.youtube\.com\/watch\?v=)([^"&?\/\s]{11})/,
    // Music URL: https://music.youtube.com/watch?v=VIDEO_ID
    /(?:music\.youtube\.com\/watch\?v=)([^"&?\/\s]{11})/
  ];

  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  return null;
}

// Common headers for requests
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
  'Cache-Control': 'max-age=0'
};

// Helper function to extract initial data from YouTube page
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

// Main search function
async function performYouTubeSearch(query: string, limit: number = 5): Promise<VideoResult[]> {
  try {
    const searchUrl = 'https://www.youtube.com/results?' + new URLSearchParams({
      search_query: query,
      sp: 'CAISAhAB'
    }).toString();

    const response = await fetch(searchUrl, {
      headers: {
        ...commonHeaders,
        'Referer': 'https://www.youtube.com/'
      }
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
          url: videoRenderer.ownerText?.runs?.[0]?.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url || ''
        },
        viewCount: videoRenderer.viewCountText?.simpleText || '',
        publishedTime: videoRenderer.publishedTimeText?.simpleText || ''
      };

      if (result.videoId && result.title) {
        results.push(result);
      }
    }

    return results;
  } catch (error) {
    console.error('Search error:', error);
    throw new Error(`Failed to perform YouTube search: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// Define the search tool
server.tool(
  "search",
  {
    query: z.string().min(1),
    limit: z.number().min(1).max(10).optional().default(5)
  },
  async ({ query, limit }) => {
    try {
      const results = await performYouTubeSearch(query, limit);
      if (results.length === 0) {
        return {
          content: [{
            type: "text",
            text: "No results found for the given query."
          }]
        };
      }
      return {
        content: [{
          type: "text",
          text: JSON.stringify(results, null, 2)
        }]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        content: [{
          type: "text",
          text: `Error performing search: ${errorMessage}`
        }],
        isError: true
      };
    }
  }
);

// Update the get-video-info tool
server.tool(
  "get-video-info",
  {
    input: z.string().min(1).describe("YouTube video ID or URL")
  },
  async ({ input }) => {
    try {
      const videoId = extractVideoId(input);
      
      if (!videoId) {
        return {
          content: [{
            type: "text",
            text: `Error: Invalid YouTube video ID or URL: ${input}`
          }],
          isError: true
        };
      }

      const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
        headers: {
          ...commonHeaders,
          'Referer': 'https://www.youtube.com/results'
        }
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
          url: channelData?.owner?.videoOwnerRenderer?.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url || ''
        },
        thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        url: `https://youtube.com/watch?v=${videoId}`
      };

      return {
        content: [{
          type: "text",
          text: JSON.stringify(result, null, 2)
        }]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        content: [{
          type: "text",
          text: `Error fetching video info: ${errorMessage}`
        }],
        isError: true
      };
    }
  }
);

// Helper function to extract transcript data
async function extractTranscript(videoId: string): Promise<{ transcript: string; videoInfo: any }> {
  try {
    // First get the video page to extract initial data
    const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        ...commonHeaders,
        'Referer': 'https://www.youtube.com/results'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const html = await response.text();
    
    // Extract the ytInitialPlayerResponse which contains captions data
    const playerResponseMatch = html.match(/ytInitialPlayerResponse\s*=\s*({.+?});/);
    if (!playerResponseMatch) {
      throw new Error('Could not find player response data');
    }

    const playerResponse = JSON.parse(playerResponseMatch[1]);
    const captions = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    
    if (!captions || captions.length === 0) {
      throw new Error('No transcript available for this video');
    }

    // Find English captions, or use the first available if no English
    const captionTrack = captions.find((track: any) => track.languageCode === 'en') || captions[0];
    if (!captionTrack?.baseUrl) {
      throw new Error('Could not find caption track URL');
    }

    // Fetch the actual transcript
    const transcriptResponse = await fetch(captionTrack.baseUrl + '&fmt=json3');
    if (!transcriptResponse.ok) {
      throw new Error('Failed to fetch transcript');
    }

    const transcriptData = await transcriptResponse.json();
    const transcriptEvents = transcriptData.events || [];

    // Process transcript events into a readable format
    const processedTranscript = transcriptEvents
      .filter((event: any) => event.segs) // Filter out events without text segments
      .map((event: any) => {
        const startTime = event.tStartMs / 1000; // Convert to seconds
        const text = event.segs.map((seg: any) => seg.utf8).join(' ').trim();
        return {
          time: startTime.toFixed(2),
          text: text
        };
      });

    // Get video info from the player response
    const videoInfo = {
      title: playerResponse.videoDetails?.title || '',
      channel: {
        name: playerResponse.videoDetails?.author || '',
      },
      duration: playerResponse.videoDetails?.lengthSeconds || ''
    };

    return {
      transcript: processedTranscript,
      videoInfo
    };
  } catch (error) {
    console.error('Transcript extraction error:', error);
    throw error;
  }
}

// Add the transcript tool
server.tool(
  "get-transcript",
  {
    input: z.string().min(1).describe("YouTube video ID or URL")
  },
  async ({ input }) => {
    try {
      const videoId = extractVideoId(input);
      
      if (!videoId) {
        return {
          content: [{
            type: "text",
            text: `Error: Invalid YouTube video ID or URL: ${input}`
          }],
          isError: true
        };
      }

      const { transcript, videoInfo } = await extractTranscript(videoId);

      const result = {
        videoId,
        videoInfo,
        transcript
      };

      return {
        content: [{
          type: "text",
          text: JSON.stringify(result, null, 2)
        }]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        content: [{
          type: "text",
          text: `Error fetching transcript: ${errorMessage}`
        }],
        isError: true
      };
    }
  }
);

// Initialize and start the server
const transport = new StdioServerTransport();
await server.connect(transport);

console.error('YouTube Search MCP Server running...'); 
console.error('Questions or feedback? Connect with me: GitHub: @spolepaka/youtube-mcp | X: @skpolepaka'); 