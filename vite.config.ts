import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin, type ViteDevServer, type PreviewServer } from 'vite'
import { createLiveIntelService } from './server/live-intel.ts'
import { createLiveIntelMiddleware } from './server/middleware.ts'
import { previewIdentity } from './server/preview-identity.ts'
import { createEndpointMonitor } from './server/endpoint-monitor.ts'
import { createEndpointMiddleware } from './server/endpoint-middleware.ts'

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

function endpointPlugin(): Plugin {
  function connect(server: ViteDevServer | PreviewServer, enabled: boolean) {
    const monitor = createEndpointMonitor()
    const middleware = createEndpointMiddleware(monitor, { enabled })
    server.middlewares.use(middleware)
    server.httpServer?.once('close', () => monitor.dispose())
  }
  return {
    name: 'cyber-local-endpoint-monitor',
    configureServer(server) { connect(server, server.config.server.host === '127.0.0.1') },
    configurePreviewServer(server) { connect(server, server.config.preview.host === '127.0.0.1') },
  }
}

export default defineConfig({
  plugins: [react(), endpointPlugin(), liveIntelPlugin()],
  // README, launcher and Go Live handoff share this fixed, local-only address.
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    headers: { 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "frame-ancestors 'none'" },
    // Only the local Go Live handoff needs cross-origin access to check readiness.
    cors: {
      origin: ['http://127.0.0.1:5500', 'http://localhost:5500', 'http://[::1]:5500'],
    },
  },
  preview: { host: '127.0.0.1' },
})
