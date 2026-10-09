import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { createLiveIntelService } from './server/live-intel.ts'
import { createLiveIntelMiddleware } from './server/middleware.ts'
import { previewIdentity } from './server/preview-identity.ts'

function liveIntelPlugin(): Plugin {
  const service = createLiveIntelService()
  const middleware = createLiveIntelMiddleware(() => service.get())
  return {
    name: 'cyber-intelligence-live-intel',
    configureServer(server) {
      const identity = previewIdentity(server.config.root)
      server.middlewares.use((_request, response, next) => {
        response.setHeader('X-Cyber-Lab-Preview', identity)
        next()
      })
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}

export default defineConfig({
  plugins: [react(), liveIntelPlugin()],
  // README, launcher and Go Live handoff share this fixed, local-only address.
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // Only the local Go Live handoff needs cross-origin access to check readiness.
    cors: {
      origin: ['http://127.0.0.1:5500', 'http://localhost:5500', 'http://[::1]:5500'],
    },
  },
})
