// Simple SSE client test for MCP server
import fetch from 'node-fetch';
import EventSource from 'eventsource';

const BASE_URL = 'http://localhost:3000';
const sessionId = 'test-session-' + Math.random().toString(36).substring(2, 9);
console.log(`Using session ID: ${sessionId}`);

// Helper to make API calls
async function callAPI(endpoint, method = 'GET', body = null) {
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  try {
    console.log(`Making ${method} request to ${endpoint}`);
    const response = await fetch(`${BASE_URL}${endpoint}`, options);
    console.log(`Response status: ${response.status}`);
    
    // Clone the response to read it twice if needed
    const contentType = response.headers.get('content-type') || '';
    
    if (contentType.includes('application/json')) {
      try {
        const data = await response.json();
        console.log('Response data:', data);
        return data;
      } catch (jsonError) {
        console.log('Failed to parse JSON response:', jsonError.message);
        return null;
      }
    } else {
      // For non-JSON responses, just get the text
      const text = await response.text();
      console.log('Response text:', text.substring(0, 200) + (text.length > 200 ? '...' : ''));
      
      // Try to parse as JSON anyway in case the content-type is wrong
      try {
        return JSON.parse(text);
      } catch (e) {
        return text;
      }
    }
  } catch (error) {
    console.error(`Error calling ${endpoint}:`, error);
    return null;
  }
}

// Check server status before connecting
async function checkStatus() {
  console.log('Checking server status...');
  const status = await callAPI('/status');
  return status;
}

// Connect to SSE endpoint
function connectSSE() {
  console.log(`\n=======================`);
  console.log(`Connecting to SSE endpoint with session ID: ${sessionId}`);
  console.log(`=======================\n`);
  
  const url = `${BASE_URL}/sse?sessionId=${sessionId}`;
  
  // Create event source
  const eventSourceOptions = { headers: { Accept: 'text/event-stream' } };
  const eventSource = new EventSource(url, eventSourceOptions);
  
  // Track connection state
  let connectionEstablished = false;
  
  eventSource.onopen = () => {
    connectionEstablished = true;
    console.log(`\n[SSE] Connection opened successfully`);
    
    // Send initialization message after connection is established
    setTimeout(() => {
      sendInitMessage();
    }, 2000);
  };
  
  eventSource.onmessage = (event) => {
    try {
      console.log(`\n[SSE] Received message:`, event.data);
      // Try to parse the data as JSON
      try {
        const jsonData = JSON.parse(event.data);
        console.log('[SSE] Parsed JSON:', jsonData);
      } catch (jsonError) {
        console.log('[SSE] Message is not valid JSON:', event.data);
      }
    } catch (error) {
      console.error('[SSE] Error handling message:', error);
    }
  };
  
  eventSource.onerror = (error) => {
    console.error(`\n[SSE] Connection error:`, error);
    
    // Log readyState
    const states = ['CONNECTING', 'OPEN', 'CLOSED'];
    console.log(`[SSE] Ready state: ${states[eventSource.readyState] || eventSource.readyState}`);
    
    // Only retry a few times to avoid infinite loop
    if (!connectionEstablished) {
      console.log('[SSE] Connection failed to establish initially.');
    }
  };
  
  return eventSource;
}

// Send initialization message to the server
async function sendInitMessage() {
  console.log('\n=======================');
  console.log('Sending init message...');
  console.log('=======================\n');
  
  const initMessage = {
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {
        tools: true,
        prompts: false,
        resources: true,
        logging: false,
        roots: {
          listChanged: false
        }
      },
      clientInfo: {
        name: "test-client",
        version: "1.0.0"
      }
    },
    jsonrpc: "2.0",
    id: 0
  };
  
  const result = await callAPI(`/messages?sessionId=${sessionId}`, 'POST', initMessage);
  
  if (result && !result.error) {
    console.log('✅ Initialization successful');
    
    // If init was successful, try calling the echo tool
    setTimeout(() => {
      testEchoTool();
    }, 2000);
  } else {
    console.log('❌ Initialization failed');
  }
}

// Test the echo tool
async function testEchoTool() {
  console.log('\n=======================');
  console.log('Testing echo tool...');
  console.log('=======================\n');
  
  const echoMessage = {
    method: "call_tool",
    params: {
      name: "echo",
      arguments: {
        message: "Hello, MCP!"
      }
    },
    jsonrpc: "2.0",
    id: 1
  };
  
  const result = await callAPI(`/messages?sessionId=${sessionId}`, 'POST', echoMessage);
  
  if (result && !result.error) {
    console.log('✅ Echo tool called successfully');
    console.log('Result:', result.result?.content?.[0]?.text || result);
  } else {
    console.log('❌ Echo tool call failed');
  }
}

// Main test function
async function runTest() {
  console.log('\n=======================');
  console.log('Starting MCP SSE test');
  console.log('=======================\n');
  
  const status = await checkStatus();
  
  if (status && status.status === 'online') {
    console.log('✅ Server is online with', status.tools?.length || 0, 'tools');
    
    const eventSource = connectSSE();
    
    // Clean up after 30 seconds
    setTimeout(() => {
      console.log('\n=======================');
      console.log('Test complete, closing SSE connection');
      console.log('=======================\n');
      eventSource.close();
      
      // Display summary
      console.log('\n=======================');
      console.log('Test Summary');
      console.log('=======================');
      console.log(`SSE Connection: ${eventSource.readyState === 1 ? '✅ Connected' : '❌ Disconnected'}`);
      console.log(`Session ID: ${sessionId}`);
      console.log('=======================\n');
      
      process.exit(0);
    }, 30000);
  } else {
    console.error('❌ Server is not online, aborting test');
    process.exit(1);
  }
}

runTest(); 