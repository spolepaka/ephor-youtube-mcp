// Comprehensive test for all YouTube MCP tools
import fetch from 'node-fetch';
import EventSource from 'eventsource';

const BASE_URL = 'http://localhost:3000';
const sessionId = 'test-session-' + Math.random().toString(36).substring(2, 9);
console.log(`Using session ID: ${sessionId}`);

// Test results tracking
const testResults = {
  connection: false,
  initialization: false,
  tools: {}
};

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
    
    const contentType = response.headers.get('content-type') || '';
    
    if (contentType.includes('application/json')) {
      try {
        const data = await response.json();
        console.log('Response data:', JSON.stringify(data).substring(0, 500) + '...');
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
    testResults.connection = true;
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
      testResults.connection = false;
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
    testResults.initialization = true;
    
    // Start testing all the tools
    await testAllTools();
  } else {
    console.log('❌ Initialization failed');
    testResults.initialization = false;
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
    console.log('Result:', result.result?.content?.[0]?.text || JSON.stringify(result));
    testResults.tools.echo = {
      success: true,
      response: result.result?.content?.[0]?.text || "Invalid response format"
    };
    return true;
  } else {
    console.log('❌ Echo tool call failed');
    testResults.tools.echo = {
      success: false,
      error: result?.error?.message || "Unknown error"
    };
    return false;
  }
}

// Test YouTube Search
async function testYouTubeSearch() {
  console.log('\n=======================');
  console.log('Testing YouTube Search tool...');
  console.log('=======================\n');
  
  const searchMessage = {
    method: "call_tool",
    params: {
      name: "youtube_search",
      arguments: {
        query: "AI programming guide",
        limit: 3
      }
    },
    jsonrpc: "2.0",
    id: 2
  };
  
  const result = await callAPI(`/messages?sessionId=${sessionId}`, 'POST', searchMessage);
  
  if (result && !result.error) {
    console.log('✅ YouTube Search tool called successfully');
    
    try {
      const content = result.result?.content?.[0]?.text;
      const searchResults = JSON.parse(content);
      
      if (Array.isArray(searchResults) && searchResults.length > 0) {
        console.log(`Found ${searchResults.length} videos`);
        console.log('First result:', searchResults[0].title);
        
        testResults.tools.youtube_search = {
          success: true,
          resultCount: searchResults.length,
          firstVideoId: searchResults[0].videoId
        };
        
        // Save the first video ID for the next tests
        return searchResults[0].videoId;
      } else {
        console.log('❌ Search returned empty or invalid results');
        testResults.tools.youtube_search = {
          success: false,
          error: "Empty or invalid results"
        };
        return null;
      }
    } catch (error) {
      console.log('❌ Failed to parse search results:', error.message);
      testResults.tools.youtube_search = {
        success: false,
        error: `Parse error: ${error.message}`
      };
      return null;
    }
  } else {
    console.log('❌ YouTube Search tool call failed');
    testResults.tools.youtube_search = {
      success: false,
      error: result?.error?.message || "Unknown error"
    };
    return null;
  }
}

// Test YouTube Video Info
async function testYouTubeVideoInfo(videoId) {
  console.log('\n=======================');
  console.log('Testing YouTube Video Info tool...');
  console.log('=======================\n');
  
  // Use provided videoId or fallback to a known one
  const testVideoId = videoId || 'dQw4w9WgXcQ'; // Fallback to Rick Roll
  
  const infoMessage = {
    method: "call_tool",
    params: {
      name: "youtube_get_video_info",
      arguments: {
        input: testVideoId
      }
    },
    jsonrpc: "2.0",
    id: 3
  };
  
  const result = await callAPI(`/messages?sessionId=${sessionId}`, 'POST', infoMessage);
  
  if (result && !result.error) {
    console.log('✅ YouTube Video Info tool called successfully');
    
    try {
      const content = result.result?.content?.[0]?.text;
      const videoInfo = JSON.parse(content);
      
      if (videoInfo && videoInfo.title) {
        console.log('Video Title:', videoInfo.title);
        console.log('Channel:', videoInfo.channel?.name);
        
        testResults.tools.youtube_get_video_info = {
          success: true,
          videoTitle: videoInfo.title,
          channelName: videoInfo.channel?.name
        };
        return true;
      } else {
        console.log('❌ Video info returned invalid data');
        testResults.tools.youtube_get_video_info = {
          success: false,
          error: "Invalid video info data"
        };
        return false;
      }
    } catch (error) {
      console.log('❌ Failed to parse video info:', error.message);
      testResults.tools.youtube_get_video_info = {
        success: false,
        error: `Parse error: ${error.message}`
      };
      return false;
    }
  } else {
    console.log('❌ YouTube Video Info tool call failed');
    testResults.tools.youtube_get_video_info = {
      success: false,
      error: result?.error?.message || "Unknown error"
    };
    return false;
  }
}

// Test YouTube Transcript
async function testYouTubeTranscript(videoId) {
  console.log('\n=======================');
  console.log('Testing YouTube Transcript tool...');
  console.log('=======================\n');
  
  // Use a known video ID that has a transcript available
  const testVideoId = 'BFiBZI3nqhQ'; // Video confirmed to have transcript
  console.log(`Using video ID: ${testVideoId} for transcript test`);
  
  const transcriptMessage = {
    method: "call_tool",
    params: {
      name: "youtube_get_transcript",
      arguments: {
        input: testVideoId
      }
    },
    jsonrpc: "2.0",
    id: 4
  };
  
  const result = await callAPI(`/messages?sessionId=${sessionId}`, 'POST', transcriptMessage);
  
  if (result && !result.error) {
    console.log('✅ YouTube Transcript tool called successfully');
    
    try {
      const content = result.result?.content?.[0]?.text;
      const transcriptData = JSON.parse(content);
      
      if (transcriptData && transcriptData.transcript && Array.isArray(transcriptData.transcript)) {
        console.log(`Transcript has ${transcriptData.transcript.length} entries`);
        if (transcriptData.transcript.length > 0) {
          console.log('First transcript entry:', transcriptData.transcript[0]);
        }
        
        testResults.tools.youtube_get_transcript = {
          success: true,
          entryCount: transcriptData.transcript.length
        };
        return true;
      } else {
        console.log('❌ Transcript returned invalid data');
        testResults.tools.youtube_get_transcript = {
          success: false,
          error: "Invalid transcript data"
        };
        return false;
      }
    } catch (error) {
      console.log('❌ Failed to parse transcript:', error.message);
      testResults.tools.youtube_get_transcript = {
        success: false,
        error: `Parse error: ${error.message}`
      };
      return false;
    }
  } else {
    console.log('❌ YouTube Transcript tool call failed');
    testResults.tools.youtube_get_transcript = {
      success: false,
      error: result?.error?.message || "Unknown error"
    };
    return false;
  }
}

// Test all tools in sequence
async function testAllTools() {
  // Remove the echo tool test
  // const echoSuccess = await testEchoTool();
  // console.log(`Echo tool test ${echoSuccess ? 'passed' : 'failed'}`);
  
  // Next, test YouTube search
  const videoId = await testYouTubeSearch();
  console.log(`YouTube Search test ${videoId ? 'passed' : 'failed'}`);
  
  // If search worked, use that videoId for subsequent tests
  if (videoId) {
    // Test video info
    const infoSuccess = await testYouTubeVideoInfo(videoId);
    console.log(`YouTube Video Info test ${infoSuccess ? 'passed' : 'failed'}`);
    
    // Test transcript
    const transcriptSuccess = await testYouTubeTranscript(videoId);
    console.log(`YouTube Transcript test ${transcriptSuccess ? 'passed' : 'failed'}`);
  } else {
    // If search failed, still test with the fallback videoId
    const infoSuccess = await testYouTubeVideoInfo();
    console.log(`YouTube Video Info test ${infoSuccess ? 'passed' : 'failed'}`);
    
    const transcriptSuccess = await testYouTubeTranscript();
    console.log(`YouTube Transcript test ${transcriptSuccess ? 'passed' : 'failed'}`);
  }
  
  // Print test summary
  printTestSummary();
}

// Print test summary
function printTestSummary() {
  console.log('\n=======================');
  console.log('🔍 TEST SUMMARY');
  console.log('=======================');
  console.log(`SSE Connection: ${testResults.connection ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`Initialization: ${testResults.initialization ? '✅ PASSED' : '❌ FAILED'}`);
  console.log('Tools:');
  
  Object.entries(testResults.tools).forEach(([tool, result]) => {
    console.log(`  - ${tool}: ${result.success ? '✅ PASSED' : '❌ FAILED'}`);
    if (result.success) {
      if (tool === 'echo') {
        console.log(`      Response: ${result.response}`);
      } else if (tool === 'youtube_search') {
        console.log(`      Found ${result.resultCount} videos`);
      } else if (tool === 'youtube_get_video_info') {
        console.log(`      Title: ${result.videoTitle}`);
        console.log(`      Channel: ${result.channelName}`);
      } else if (tool === 'youtube_get_transcript') {
        console.log(`      Transcript entries: ${result.entryCount}`);
      }
    } else {
      console.log(`      Error: ${result.error}`);
    }
  });
  
  console.log('=======================');
  
  // Check overall success
  const allPassed = 
    testResults.connection && 
    testResults.initialization && 
    Object.values(testResults.tools).every(tool => tool.success);
  
  console.log(`\nOverall Test Status: ${allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
}

// Main test function
async function runTest() {
  console.log('\n=======================');
  console.log('Starting YouTube MCP Tools Test');
  console.log('=======================\n');
  
  const status = await checkStatus();
  
  if (status && status.status === 'online') {
    console.log('✅ Server is online with', status.tools?.length || 0, 'tools available');
    
    // Make sure all required tools are available
    const requiredTools = ['youtube_search', 'youtube_get_video_info', 'youtube_get_transcript']; // Removed echo
    const availableTools = status.tools?.map(tool => tool.name) || [];
    
    const missingTools = requiredTools.filter(tool => !availableTools.includes(tool));
    
    if (missingTools.length > 0) {
      console.error('❌ Some required tools are missing:', missingTools.join(', '));
      process.exit(1);
    }
    
    console.log('✅ All required tools are available');
    
    const eventSource = connectSSE();
    
    // Clean up after 60 seconds
    setTimeout(() => {
      console.log('\n=======================');
      console.log('Test complete, closing SSE connection');
      console.log('=======================\n');
      eventSource.close();
      
      // Final test summary
      printTestSummary();
      
      // Exit with appropriate code
      const allPassed = 
        testResults.connection && 
        testResults.initialization && 
        Object.values(testResults.tools).every(tool => tool.success);
      
      process.exit(allPassed ? 0 : 1);
    }, 60000);
  } else {
    console.error('❌ Server is not online, aborting test');
    process.exit(1);
  }
}

runTest(); 