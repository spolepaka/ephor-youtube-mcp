# YouTube MCP Integration

This project provides a [Model Context Protocol (MCP)](https://github.com/modelcontextprotocol/typescript-sdk) integration for YouTube, allowing LLMs to search YouTube, get video information, and retrieve transcripts via standardized tools.

## Features

- **YouTube Search Tool**: Search for videos on YouTube with configurable result limits
- **Video Info Tool**: Get detailed information about a YouTube video
- **Transcript Tool**: Retrieve and parse the transcript of a YouTube video

## Architecture

The implementation follows the Model Context Protocol (MCP) specification, which standardizes how LLMs interact with external tools and resources. The architecture consists of:

1. **MCP Server**: Provides YouTube functionality as MCP tools through HTTP/SSE transport
2. **YouTube API Integration**: Scrapes YouTube data to provide search, video info, and transcript functionality
3. **MCP Client**: Example client showing how to consume the MCP YouTube tools

## Getting Started

### Prerequisites

- Node.js 18+
- npm

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/ephor-youtube-mcp.git
cd ephor-youtube-mcp

# Install dependencies
npm install

# Build the project
npm run build
```

### Running the Server

Start the MCP server:

```bash
npm run start
```

The server will start on http://localhost:3000 with the following endpoints:
- SSE endpoint: `/sse`
- Message endpoint: `/messages`

### Using with an MCP Client

The MCP tools can be used with any MCP-compatible client. Here's an example of how to use the tools:

```typescript
// Initialize client
const client = new Client(
  { name: 'youtube-client', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

// Connect to the server
await client.connect(transport);

// Search YouTube
const searchResults = await client.callTool({
  name: 'youtube_search',
  arguments: {
    query: 'javascript tutorial',
    limit: 3
  }
});

// Get video info
const videoInfo = await client.callTool({
  name: 'youtube_get_video_info',
  arguments: {
    input: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
  }
});

// Get video transcript
const transcript = await client.callTool({
  name: 'youtube_get_transcript',
  arguments: {
    input: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
  }
});
```

## Available Tools

### `youtube_search`

Search for YouTube videos.

**Arguments:**
- `query` (string, required): The search query
- `limit` (number, optional): Maximum number of results (1-10, default: 5)

**Response:**
A list of video results with details like title, video ID, URL, thumbnail, description, channel info, view count, and publish date.

### `youtube_get_video_info`

Get detailed information about a YouTube video.

**Arguments:**
- `input` (string, required): YouTube video ID or URL

**Response:**
Detailed video information including title, description, view count, publish date, channel details, and thumbnail URL.

### `youtube_get_transcript`

Get the transcript of a YouTube video.

**Arguments:**
- `input` (string, required): YouTube video ID or URL

**Response:**
The video transcript with timestamped entries, along with basic video information.

## License

MIT

## Acknowledgements

- [Model Context Protocol](https://github.com/modelcontextprotocol/typescript-sdk)
