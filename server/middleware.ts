import type { IncomingMessage, ServerResponse } from 'node:http'
import type { LiveIntelPayload } from '../shared/live-intel.ts'

export function createLiveIntelMiddleware(getPayload: () => Promise<LiveIntelPayload>) {
  return async (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    // Do not mount as a Connect prefix: /api/live-intel-extra must not match.
    if (request.url?.split('?')[0] !== '/api/live-intel') {
      next()
      return
    }
    response.setHeader('content-type', 'application/json; charset=utf-8')
    response.setHeader('cache-control', 'no-store')
    response.setHeader('x-content-type-options', 'nosniff')
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.statusCode = 405
      response.setHeader('allow', 'GET, HEAD')
      response.end(JSON.stringify({ error: 'Method not allowed' }))
      return
    }
    try {
      const body = JSON.stringify(await getPayload())
      response.statusCode = 200
      response.setHeader('content-length', Buffer.byteLength(body))
      response.end(request.method === 'HEAD' ? undefined : body)
    } catch {
      response.statusCode = 503
      const body = JSON.stringify({ error: 'Live intelligence is temporarily unavailable.' })
      response.setHeader('content-length', Buffer.byteLength(body))
      response.end(request.method === 'HEAD' ? undefined : body)
    }
  }
}
