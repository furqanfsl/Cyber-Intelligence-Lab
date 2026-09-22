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
})
