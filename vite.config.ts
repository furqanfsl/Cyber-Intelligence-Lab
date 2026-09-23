import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { createLiveIntelService } from './server/live-intel.ts'
import { createLiveIntelMiddleware } from './server/middleware.ts'

function liveIntelPlugin(): Plugin {
  const service = createLiveIntelService()
  const middleware = createLiveIntelMiddleware(() => service.get())
  return {
    name: 'cyber-intelligence-live-intel',
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}

export default defineConfig({
  plugins: [react(), liveIntelPlugin()],
  // VS Code Live Server forwards Go Live here. Do not silently switch ports:
  // a different port would leave its proxy pointing at the wrong process.
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // Live Server's older proxy does not reliably forward WebSocket upgrades.
    // Connect HMR directly to Vite even when the page is opened on port 5500.
    hmr: {
      host: '127.0.0.1',
      clientPort: 5173,
    },
  },
})
