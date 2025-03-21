import express, { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import path from 'path';
import { fileURLToPath } from 'url';

// Get directory name in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// Serve the index.html file
app.get('/', (req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'simple-test.html'));
});

// Create a simple MCP server
const server = new McpServer({
  name: "simple-mcp-test",
  version: "1.0.0",
  description: "Simple MCP test server"
});

// Define a simple echo tool
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

// Map to store active transports
const activeTransports = new Map<string, SSEServerTransport>();

// Session endpoint
app.get("/session", (req: Request, res: Response) => {
  try {
    const sessionId = Math.random().toString(36).substring(2, 15);
    console.log(`New session created: ${sessionId}`);
    res.json({ sessionId });
  } catch (error) {
    console.error('Error creating session:', error);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

// SSE endpoint
app.get("/sse", async (req: Request, res: Response) => {
  // Use a provided session ID or create a default one
  const sessionId = (req.query.sessionId as string) || 'default-session';
  
  try {
    console.log(`Creating SSE transport for session ${sessionId}`);
    
    // If there's an existing transport for this session ID, remove it
    if (activeTransports.has(sessionId)) {
      console.log(`Replacing existing transport for session ${sessionId}`);
      activeTransports.delete(sessionId);
    }
    
    // Create a transport
    const transport = new SSEServerTransport("/messages", res);
    
    // Store the transport
    activeTransports.set(sessionId, transport);
    console.log(`Active sessions: ${Array.from(activeTransports.keys()).join(', ')}`);
    
    // Connect the server to the transport
    await server.connect(transport);
    
    // Handle client disconnect
    req.on('close', () => {
      console.log(`Client disconnected: ${sessionId}`);
      activeTransports.delete(sessionId);
    });
  } catch (error) {
    console.error(`Error with SSE connection for session ${sessionId}:`, error);
    res.end();
    activeTransports.delete(sessionId);
  }
});

// Message endpoint with additional format handling
app.post("/messages", async (req: Request, res: Response) => {
  // Use a provided session ID or use the default one
  const sessionId = (req.query.sessionId as string) || 'default-session';
  
  console.log(`Message received for session ${sessionId}`);
  console.log(`Active sessions: ${Array.from(activeTransports.keys()).join(', ')}`);
  console.log('Request body:', JSON.stringify(req.body, null, 2)); // Log the full request
  
  const transport = activeTransports.get(sessionId);
  
  if (!transport) {
    console.log(`Session ${sessionId} not found in active transports`);
    return res.status(404).json({ 
      error: { code: -32000, message: "No active connection found. Please connect to the SSE endpoint first." }
    });
  }
  
  try {
    console.log(`Handling message for session ${sessionId}`);
    
    // Handle the special case for call_tool method
    const body = req.body;
    if (body.method === 'call_tool' && body.jsonrpc === '2.0' && body.params) {
      const { name, arguments: args } = body.params;
      
      if (name === 'echo') {
        console.log(`Custom handling for echo tool with message: ${args.message}`);
        
        // Directly return the result without going through transport
        return res.json({
          jsonrpc: '2.0',
          result: {
            content: [{ type: "text", text: `You said: ${args.message}` }]
          },
          id: body.id
        });
      }
    }
    
    // If it's not a special case, proceed with normal handling
    await transport.handlePostMessage(req, res);
    console.log(`Successfully handled message for session ${sessionId}`);
  } catch (error) {
    // More detailed error logging
    console.error('Error handling message:', error);
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    return res.status(500).json({ 
      error: { 
        code: -32603, 
        message: error instanceof Error ? error.message : "Failed to process message",
        data: error instanceof Error ? error.stack : undefined
      }
    });
  }
});

// Create a simplified endpoint for direct tool calls
app.post("/simple-call", async (req: Request, res: Response) => {
  // Make sessionId optional
  const sessionId = (req.query.sessionId as string) || 'default-session';
  const { name, arguments: args } = req.body;
  
  console.log(`Simple call, tool: ${name}`);
  console.log('Arguments:', JSON.stringify(args, null, 2));
  
  if (!name || !args) {
    return res.status(400).json({ error: "Missing name or arguments" });
  }
  
  // Find the tool implementation directly
  if (name === "echo") {
    const message = args.message;
    console.log(`Executing echo with message: ${message}`);
    
    // Return a successful response in the expected format
    return res.json({
      result: {
        content: [{ type: "text", text: `You said: ${message}` }]
      }
    });
  } else {
    return res.status(404).json({ error: "Tool not found" });
  }
});

// Add a simple test endpoint
app.get("/test", (req: Request, res: Response) => {
  res.json({ status: "ok", message: "Server is working!" });
});

// Handle GET requests to /messages (needed for MCP SDK initialization)
app.get("/messages", (req: Request, res: Response) => {
  console.log('GET request to /messages endpoint received');
  // Just return a 200 OK status to acknowledge the endpoint exists
  res.status(200).json({ status: "ok", message: "Messages endpoint available for POST requests" });
});

// Start the server
const PORT = 3002;
app.listen(PORT, () => {
  console.log('--------------------------------------------------');
  console.log(`Simple MCP Test Server running on http://localhost:${PORT}`);
  console.log('--------------------------------------------------');
  console.log('MCP Endpoints:');
  console.log(`  - Test Page: http://localhost:${PORT}/`);
  console.log(`  - SSE: http://localhost:${PORT}/sse`);
  console.log(`  - Messages: http://localhost:${PORT}/messages`);
  console.log('  (Session ID is optional for both SSE and Messages endpoints)');
  console.log('--------------------------------------------------');
  console.log('Direct API Endpoints (No MCP):');
  console.log(`  - Test: http://localhost:${PORT}/test`);
  console.log(`  - Simple Call: http://localhost:${PORT}/simple-call`);
  console.log('--------------------------------------------------');
}); 