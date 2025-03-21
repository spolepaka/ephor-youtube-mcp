#!/bin/bash

# Make sure server is running
echo "Checking if server is running at http://localhost:3000..."
curl -s http://localhost:3000/status > /dev/null
if [ $? -ne 0 ]; then
  echo "❌ Server does not appear to be running. Please start it with 'npm start' first."
  exit 1
fi
echo "✅ Server is running"

# Install dependencies if needed
if [ ! -d "node_modules/eventsource" ] || [ ! -d "node_modules/node-fetch" ]; then
  echo "Installing required dependencies..."
  npm install --save eventsource@^2.0.2 node-fetch@^2.6.7
fi

# Run the test
echo "Running YouTube MCP tools tests..."
node test-youtube-tools.js

# Check test result
if [ $? -eq 0 ]; then
  echo "✅ All tests passed!"
  exit 0
else
  echo "❌ Some tests failed. Check the output above for details."
  exit 1
fi 