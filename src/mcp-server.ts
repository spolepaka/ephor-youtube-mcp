import express, { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import * as cheerio from 'cheerio';
import path from 'path';
import { fileURLToPath } from 'url';

// Get directory name in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  'Cache-Control': 'max-age=0',
};

// Define interfaces for responses
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

// Helper function to extract video ID from URL
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

// Helper function to extract transcript data
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

// Async function to get video info
async function getVideoInfo(videoId: string): Promise<any> {
  try {
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

    return {
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
  } catch (error) {
    throw error;
  }
}

// Initialize Express app
const app = express();
app.use(express.json());

// Debug middleware to log all requests
app.use((req: Request, res: Response, next: () => void) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Add CORS middleware
app.use((req: Request, res: Response, next: () => void) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// Handle OPTIONS requests
app.options('*', (req: Request, res: Response) => {
  res.status(200).end();
});

// Serve static files from public directory but with a specific route prefix
// to avoid conflicting with API routes
app.use("/static", express.static(path.join(__dirname, '..', 'public')));

// Create MCP server
const server = new McpServer({
  name: "youtube-mcp",
  version: "1.0.0",
  description: "YouTube search, video information, and transcript extraction"
});

// Map to store active transports
const activeTransports = new Map<string, {
  connected: boolean;
  response: Response;
}>();

// Track active connections
let connectionCount = 0;
let globalConnection: Response | null = null;

// Add a simple test endpoint
app.get("/test", (req: Request, res: Response) => {
  console.log('Test endpoint hit!');
  res.json({ status: "ok", message: "Test endpoint working!" });
});

// Add a new endpoint for getting session IDs (explicitly defined early)
app.get("/session", (req: Request, res: Response) => {
  try {
    console.log('[SESSION] Session endpoint hit!');
    const sessionId = Math.random().toString(36).substring(2, 15);
    console.log(`[SESSION] New session created: ${sessionId}`);
    
    // Add CORS headers
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Content-Type', 'application/json');
    
    // Return the session ID
    res.json({ sessionId });
    console.log('[SESSION] Response sent successfully');
  } catch (error) {
    console.error('[SESSION] Error creating session:', error);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

// Define YouTube search tool
server.tool(
  "youtube_search",
  { 
    query: z.string().min(1),
    limit: z.number().min(1).max(10).default(5)
  },
  async ({ query, limit }) => {
    try {
      const results = await performYouTubeSearch(query, limit);
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify(results)
        }]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [{ type: "text", text: JSON.stringify({ error: `Error performing search: ${errorMessage}` }) }],
        isError: true
      };
    }
  }
);

// Define YouTube video info tool
server.tool(
  "youtube_get_video_info",
  { input: z.string().min(1) },
  async ({ input }) => {
    try {
      const videoId = extractVideoId(input);
      if (!videoId) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: `Invalid YouTube video ID or URL: ${input}` }) }],
          isError: true
        };
      }
      
      const result = await getVideoInfo(videoId);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [{ type: "text", text: JSON.stringify({ error: `Error fetching video info: ${errorMessage}` }) }],
        isError: true
      };
    }
  }
);

// Define YouTube transcript tool
server.tool(
  "youtube_get_transcript",
  { input: z.string().min(1) },
  async ({ input }) => {
    try {
      const videoId = extractVideoId(input);
      if (!videoId) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: `Invalid YouTube video ID or URL: ${input}` }) }],
          isError: true
        };
      }
      
      const { transcript, videoInfo } = await extractTranscript(videoId);
      const result = { videoId, videoInfo, transcript };
      return {
        content: [{ type: "text", text: JSON.stringify(result) }]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [{ type: "text", text: JSON.stringify({ error: `Error fetching transcript: ${errorMessage}` }) }],
        isError: true
      };
    }
  }
);

// Define a simple echo tool to test tool calling
server.tool(
  "echo",
  { message: z.string() },
  async ({ message }) => {
    console.log(`Echo tool called with message: ${message}`);
    return {
      content: [{ type: "text", text: `You said: ${message}` }]
    };
  }
);

// Set up SSE endpoint for MCP
app.get("/sse", (req: Request, res: Response) => {
  console.log(`[${new Date().toISOString()}] SSE connection request received`);
  
  // Set CORS and SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  // Keep connection alive
  const keepAlive = setInterval(() => {
    if (!res.writableEnded) {
      res.write(": keepalive\n\n");
    } else {
      clearInterval(keepAlive);
      console.log("Connection ended, clearing keepalive");
    }
  }, 15000);
  
  // Log connection
  console.log("SSE connection established");
  globalConnection = res;
  connectionCount = 1;
  
  // Handle disconnection
  req.on('close', () => {
    clearInterval(keepAlive);
    globalConnection = null;
    connectionCount = 0;
    console.log("SSE connection closed");
  });
});

// Set up message endpoint for client->server communication
app.post("/messages", (req: Request, res: Response) => {
  console.log(`[${new Date().toISOString()}] Message received: ${JSON.stringify(req.body)}`);
  
  // Extract key info from request
  const body = req.body;
  const id = body.id || null;
  const method = body.method || "";
  
  // Handle initialization
  if (method === 'initialize') {
    console.log("Handling initialization request");
    return res.json({
      jsonrpc: "2.0",
      result: {
        serverInfo: {
          name: "youtube-mcp",
          version: "1.0.0"
        },
        protocolVersion: "2024-11-05",
        tools: [
          {
            name: "youtube_search",
            description: "Search for YouTube videos",
            schema: {
              type: "object",
              properties: {
                query: { type: "string", description: "The search query" },
                limit: { type: "number", description: "Maximum number of results (1-10)", default: 5 }
              },
              required: ["query"]
            }
          },
          {
            name: "youtube_get_video_info",
            description: "Get information about a YouTube video",
            schema: {
              type: "object",
              properties: {
                input: { type: "string", description: "YouTube video ID or URL" }
              },
              required: ["input"]
            }
          },
          {
            name: "youtube_get_transcript",
            description: "Get the transcript of a YouTube video",
            schema: {
              type: "object",
              properties: {
                input: { type: "string", description: "YouTube video ID or URL" }
              },
              required: ["input"]
            }
          },
          {
            name: "echo",
            description: "Echo a message back",
            schema: {
              type: "object",
              properties: {
                message: { type: "string", description: "Message to echo back" }
              },
              required: ["message"]
            }
          }
        ]
      },
      id
    });
  }
  
  // Handle tool calls
  if (method === 'call_tool' && body.params) {
    const toolName = body.params.name;
    const args = body.params.arguments || {};
    
    console.log(`Tool call: ${toolName} with args:`, args);
    
    // Handle echo tool
    if (toolName === 'echo' && args.message) {
      console.log(`Echo tool: ${args.message}`);
      return res.json({
        jsonrpc: "2.0",
        result: {
          content: [{ type: "text", text: `You said: ${args.message}` }]
        },
        id
      });
    }
    
    // Handle YouTube search
    if (toolName === 'youtube_search' && args.query) {
      return handleYouTubeSearch(args.query, args.limit || 5, id, res);
    }
    
    // Handle Video Info
    if (toolName === 'youtube_get_video_info' && args.input) {
      return handleVideoInfo(args.input, id, res);
    }
    
    // Handle Transcript
    if (toolName === 'youtube_get_transcript' && args.input) {
      return handleTranscript(args.input, id, res);
    }
    
    // Unknown tool
    return res.json({
      jsonrpc: "2.0",
      error: {
        code: -32601,
        message: `Unknown tool: ${toolName}`
      },
      id
    });
  }
  
  // Unknown method
  return res.json({
    jsonrpc: "2.0",
    error: {
      code: -32601,
      message: `Unknown method: ${method}`
    },
    id
  });
});

// Helper functions for handling YouTube tools
async function handleYouTubeSearch(query: string, limit: number, id: string | null, res: Response) {
  try {
    const results = await performYouTubeSearch(query, limit);
    return res.json({
      jsonrpc: "2.0",
      result: {
        content: [{ type: "text", text: JSON.stringify(results) }]
      },
      id
    });
  } catch (error) {
    return res.json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: error instanceof Error ? error.message : "Unknown error"
      },
      id
    });
  }
}

async function handleVideoInfo(input: string, id: string | null, res: Response) {
  try {
    const videoId = extractVideoId(input);
    if (!videoId) {
      return res.json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: `Invalid YouTube video ID or URL: ${input}`
        },
        id
      });
    }
    
    const result = await getVideoInfo(videoId);
    return res.json({
      jsonrpc: "2.0",
      result: {
        content: [{ type: "text", text: JSON.stringify(result) }]
      },
      id
    });
  } catch (error) {
    return res.json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: error instanceof Error ? error.message : "Unknown error"
      },
      id
    });
  }
}

async function handleTranscript(input: string, id: string | null, res: Response) {
  try {
    const videoId = extractVideoId(input);
    if (!videoId) {
      return res.json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: `Invalid YouTube video ID or URL: ${input}`
        },
        id
      });
    }
    
    const { transcript, videoInfo } = await extractTranscript(videoId);
    const result = { videoId, videoInfo, transcript };
    
    return res.json({
      jsonrpc: "2.0",
      result: {
        content: [{ type: "text", text: JSON.stringify(result) }]
      },
      id
    });
  } catch (error) {
    return res.json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: error instanceof Error ? error.message : "Unknown error"
      },
      id
    });
  }
}

// Set up a specific route for the index.html file
app.get("/", (req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Add a status endpoint
app.get("/status", (req: Request, res: Response) => {
  res.json({
    status: "online",
    activeConnections: connectionCount,
    hasGlobalConnection: globalConnection !== null,
    tools: [
      {
        name: "youtube_search",
        description: "Search for YouTube videos"
      },
      {
        name: "youtube_get_video_info",
        description: "Get information about a YouTube video"
      },
      {
        name: "youtube_get_transcript",
        description: "Get the transcript of a YouTube video"
      },
      {
        name: "echo",
        description: "Echo a message back"
      }
    ]
  });
});

// Add a simplified direct endpoint for YouTube tools
app.post("/direct/youtube-search", async (req: Request, res: Response) => {
  try {
    console.log('Direct YouTube search call received');
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    
    const { query, limit = 5 } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: "Missing query parameter" });
    }
    
    const results = await performYouTubeSearch(query, limit);
    return res.json({ results });
  } catch (error) {
    console.error('Error in direct YouTube search:', error);
    return res.status(500).json({ 
      error: error instanceof Error ? error.message : "Failed to search YouTube" 
    });
  }
});

app.post("/direct/youtube-video-info", async (req: Request, res: Response) => {
  try {
    console.log('Direct YouTube video info call received');
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    
    const { input } = req.body;
    
    if (!input) {
      return res.status(400).json({ error: "Missing input parameter" });
    }
    
    const videoId = extractVideoId(input);
    if (!videoId) {
      return res.status(400).json({ error: `Invalid YouTube video ID or URL: ${input}` });
    }
    
    const result = await getVideoInfo(videoId);
    return res.json({ result });
  } catch (error) {
    console.error('Error in direct YouTube video info:', error);
    return res.status(500).json({ 
      error: error instanceof Error ? error.message : "Failed to get video info" 
    });
  }
});

app.post("/direct/youtube-transcript", async (req: Request, res: Response) => {
  try {
    console.log('Direct YouTube transcript call received');
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    
    const { input } = req.body;
    
    if (!input) {
      return res.status(400).json({ error: "Missing input parameter" });
    }
    
    const videoId = extractVideoId(input);
    if (!videoId) {
      return res.status(400).json({ error: `Invalid YouTube video ID or URL: ${input}` });
    }
    
    const { transcript, videoInfo } = await extractTranscript(videoId);
    return res.json({ videoId, videoInfo, transcript });
  } catch (error) {
    console.error('Error in direct YouTube transcript:', error);
    return res.status(500).json({ 
      error: error instanceof Error ? error.message : "Failed to get transcript" 
    });
  }
});

// Add a route for the direct API test page
app.get('/direct-test', (req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'direct-youtube.html'));
});

// Add a debug endpoint to check connection state
app.get("/debug/connection", (req: Request, res: Response) => {
  const connectionInfo = {
    hasGlobalConnection: globalConnection !== null,
    isConnectionActive: globalConnection ? !globalConnection.writableEnded : false,
    totalConnections: connectionCount
  };
  
  return res.json(connectionInfo);
});

// Handle GET requests to /messages (needed for MCP SDK initialization)
app.get("/messages", (req: Request, res: Response) => {
  console.log('GET request to /messages endpoint received');
  // Just return a 200 OK status to acknowledge the endpoint exists
  res.status(200).json({ status: "ok", message: "Messages endpoint available for POST requests" });
});

// Start the server
const PORT = 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log('--------------------------------------------------');
  console.log(`YouTube MCP Server running on http://localhost:${PORT}`);
  console.log('--------------------------------------------------');
  console.log('MCP Endpoints:');
  console.log(`  - Web Client: http://localhost:${PORT}/`);
  console.log(`  - SSE: http://localhost:${PORT}/sse`);
  console.log(`  - Messages: http://localhost:${PORT}/messages`);
  console.log('  (Session ID is optional for both SSE and Messages endpoints)');
  console.log('--------------------------------------------------');
  console.log('Direct API Endpoints (No MCP):');
  console.log(`  - Test Page: http://localhost:${PORT}/direct-test`);
  console.log(`  - YouTube Search: http://localhost:${PORT}/direct/youtube-search`);
  console.log(`  - Video Info: http://localhost:${PORT}/direct/youtube-video-info`);
  console.log(`  - Transcript: http://localhost:${PORT}/direct/youtube-transcript`);
  console.log('--------------------------------------------------');
  console.log('Debug Endpoints:');
  console.log(`  - Check Session: http://localhost:${PORT}/debug/session/YOUR_SESSION_ID`);
  console.log(`  - Server Status: http://localhost:${PORT}/status`);
  console.log('--------------------------------------------------');
});