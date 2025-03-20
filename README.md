# YouTube MCP Server (NO API REQUIRED)

A Model Context Protocol (MCP) server that enables YouTube search, video info retrieval, and transcript extraction with NO API KEYS required.

## Features

* Search YouTube videos with customizable result limits
* Get detailed video information from any YouTube URL or video ID
* Extract video transcripts (captions) with timestamps
* No API keys or authentication required
* Support for multiple YouTube URL formats
* Automatic language selection (prioritizes English)
* Returns structured results with rich metadata

## Installation

1. Clone or download this repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the server:
   ```bash
   npm run build
   ```
4. Add the server to your MCP configuration:

  For Claude Desktop:
  ```json
  {
    "mcpServers": {
      "youtube-search": {
        "command": "node",
        "args": ["/absolute/path/to/youtube-mcp/build/index.js"]
      }
    }
  }
  ```
  (Replace with the absolute path to the index.js file on your system)

  Configuration file location:
  - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
  - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`

  For Cursor:
  1. Go to Settings → MCP → Add a new MCP server
  2. Fill in the fields:
    - Name: youtube
    - Type: command
    - Command: node /absolute/path/to/youtube-mcp/build/index.js
    
    (Replace with the absolute path to the index.js file on your system)

## Usage

The server provides three tools:

### 1. Search Tool (`search`)
```json
{
  "query": string,    // The search query
  "limit": number     // Optional: Number of results to return (default: 5, max: 10)
}
```

Example response:
```json
[
  {
    "videoId": "dQw4w9WgXcQ",
    "title": "Video Title",
    "url": "https://youtube.com/watch?v=dQw4w9WgXcQ",
    "thumbnailUrl": "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    "description": "Video description...",
    "channel": {
      "name": "Channel Name",
      "url": "https://youtube.com/channel/..."
    },
    "viewCount": "1M views",
    "publishedTime": "3 years ago"
  }
]
```

### 2. Video Info Tool (`get-video-info`)
```json
{
  "input": string    // YouTube video ID or URL
}
```

Supported URL formats:
- Direct video ID: `dQw4w9WgXcQ`
- Standard watch URL: `https://www.youtube.com/watch?v=dQw4w9WgXcQ`
- Short URL: `https://youtu.be/dQw4w9WgXcQ`
- Embed URL: `https://www.youtube.com/embed/dQw4w9WgXcQ`
- Mobile URL: `https://m.youtube.com/watch?v=dQw4w9WgXcQ`
- Music URL: `https://music.youtube.com/watch?v=dQw4w9WgXcQ`

### 3. Transcript Tool (`get-transcript`)
```json
{
  "input": string    // YouTube video ID or URL
}
```

Example response:
```json
{
  "videoId": "dQw4w9WgXcQ",
  "videoInfo": {
    "title": "Video Title",
    "channel": {
      "name": "Channel Name"
    },
    "duration": "212"
  },
  "transcript": [
    {
      "time": "0.00",
      "text": "First caption..."
    },
    {
      "time": "2.50",
      "text": "Next caption..."
    }
  ]
}
```

## Limitations

Since this tool uses web scraping of YouTube pages, there are some important limitations to be aware of:

1. **Rate Limiting**:
   * YouTube may temporarily block requests if too many are made in a short time
   * Keep requests to a reasonable frequency
   * Consider implementing delays between requests
   * Use the limit parameter judiciously

2. **Transcript Availability**:
   * Not all videos have transcripts/captions available
   * Some videos may only have auto-generated captions
   * Some videos may only have non-English captions
   * Private videos are not accessible

3. **Result Accuracy**:
   * The tool relies on YouTube's HTML structure, which may change
   * Some metadata might be missing or incomplete
   * Search results may vary based on region/language settings

4. **Legal Considerations**:
   * This tool is intended for personal use
   * Respect YouTube's terms of service
   * Consider implementing appropriate rate limiting for your use case

## Error Handling

The server provides clear error messages for common issues:

1. Invalid video IDs or URLs:
   ```json
   {
     "error": "Invalid YouTube video ID or URL: input"
   }
   ```

2. Missing transcripts:
   ```json
   {
     "error": "No transcript available for this video"
   }
   ```

3. Network or parsing errors:
   ```json
   {
     "error": "Failed to fetch video data: HTTP error status 429"
   }
   ```

## Contributing

Feel free to submit issues and enhancement requests!

## Connect & Feedback

Have questions, suggestions, or need help with this tool? Connect with me:

- GitHub: [@spolepaka/youtube-mcp](https://github.com/spolepaka/youtube-mcp)
- X (Twitter): [@skpolepaka](https://x.com/skpolepaka)

Your feedback helps improve this tool for everyone!
