import express, { Request, Response } from 'express';

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

// Add a simple test endpoint
app.get("/test", (req: Request, res: Response) => {
  console.log('Test endpoint hit!');
  res.json({ status: "ok", message: "Test endpoint working!" });
});

// Add session endpoint
app.get("/session", (req: Request, res: Response) => {
  console.log('Session endpoint hit!');
  const sessionId = Math.random().toString(36).substring(2, 15);
  console.log(`New session created: ${sessionId}`);
  res.json({ sessionId });
});

// Start the server
const PORT = 3001; // Different port from the main server
app.listen(PORT, () => {
  console.log('--------------------------------------------------');
  console.log(`Test Server running on http://localhost:${PORT}`);
  console.log(`Test endpoint: http://localhost:${PORT}/test`);
  console.log(`Session endpoint: http://localhost:${PORT}/session`);
  console.log('--------------------------------------------------');
  console.log('Registered routes:');
  app._router.stack.forEach((middleware: any) => {
    if (middleware.route) {
      console.log(`${middleware.route.path} - ${Object.keys(middleware.route.methods).join(',')}`);
    }
  });
  console.log('--------------------------------------------------');
}); 