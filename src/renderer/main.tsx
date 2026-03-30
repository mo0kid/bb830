import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initApiHandler } from './api-handler';

// Start polling for MCP API commands
initApiHandler();

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
