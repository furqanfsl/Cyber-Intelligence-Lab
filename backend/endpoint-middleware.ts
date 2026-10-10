import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

export type EndpointMonitorApi = {
  getSnapshot(): unknown
  start(options: { includeSysmon: boolean }): Promise<unknown>
  stop(): unknown
}

type Options = { enabled?: boolean; platform?: string; randomToken?: () => string; bodyTimeoutMs?: number }
const CLIENT_HEADER = 'x-cyber-lab-endpoint-client'
const TOKEN_HEADER = 'x-cyber-lab-endpoint-token'
const MAX_BODY = 1_024
const PRIVATE_ROUTES = new Map([
  ['/api/endpoint/session', 'GET'], ['/api/endpoint/status', 'GET'],
  ['/api/endpoint/start', 'POST'], ['/api/endpoint/stop', 'POST'],
])
const PROXY_HEADERS = new Set([
  'forwarded', 'via', 'x-real-ip', 'cf-connecting-ip', 'true-client-ip',
  'x-client-ip', 'client-ip', 'x-cluster-client-ip', 'x-originating-ip',
])

function forwarded(request: IncomingMessage) {
  // A private loopback socket may actually be an internet-facing reverse proxy.
  // Never trust its rewritten Host or Fetch Metadata as proof of a local user.
  return Object.keys(request.headers).some((name) => {
    const normalized = name.toLowerCase()
    return normalized.startsWith('x-forwarded-') || PROXY_HEADERS.has(normalized)
  })
}

function loopback(address: string | undefined) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function localOrigin(request: IncomingMessage) {
  if (!loopback(request.socket.remoteAddress) || !loopback(request.socket.localAddress)) return null
  const host = request.headers.host
  if (typeof host !== 'string') return null
  const match = /^(127\.0\.0\.1|localhost|\[::1\]):([1-9]\d{0,4})$/.exec(host)
  if (!match || Number(match[2]) > 65_535 || Number(match[2]) !== request.socket.localPort) return null
  return `http://${host}`
}

function privateHeaders(response: ServerResponse) {
  // Vite permits Go Live readiness CORS. That permission never applies to telemetry.
  for (const name of response.getHeaderNames()) if (name.toLowerCase().startsWith('access-control-')) response.removeHeader(name)
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.setHeader('x-content-type-options', 'nosniff')
  response.setHeader('x-frame-options', 'DENY')
  response.setHeader('content-security-policy', "default-src 'none'; frame-ancestors 'none'")
  response.setHeader('referrer-policy', 'no-referrer')
}

function send(response: ServerResponse, status: number, value: unknown) {
  if (response.destroyed || response.writableEnded) return
  const body = JSON.stringify(value)
  response.statusCode = status
  response.setHeader('content-length', Buffer.byteLength(body))
  response.end(body)
}

function fail(response: ServerResponse, status: number, code: string, error: string) {
  send(response, status, { code, error })
}

async function body(request: IncomingMessage, timeoutMs: number) {
  const declared = request.headers['content-length']
  if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY)) {
    throw new RangeError('body limit')
  }
  return await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = []
    let bytes = 0
    let settled = false
    const deadline = setTimeout(() => {
      finish(new Error('body deadline'))
      request.destroy()
    }, timeoutMs)
    deadline.unref()
    function finish(error?: Error) {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      request.removeListener('data', data)
      request.removeListener('end', end)
      request.removeListener('error', disconnected)
      request.removeListener('aborted', disconnected)
      if (error) reject(error)
      else {
        try { resolve(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks))) }
        catch { reject(new Error('body encoding')) }
      }
    }
    function data(chunk: Buffer | string) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      bytes += buffer.byteLength
      if (bytes > MAX_BODY) { request.pause(); finish(new RangeError('body limit')); return }
      chunks.push(buffer)
    }
    function end() { finish() }
    function disconnected() { finish(new Error('body disconnected')) }
    request.on('data', data)
    request.once('end', end)
    request.once('error', disconnected)
    request.once('aborted', disconnected)
    if (request.destroyed || request.aborted) disconnected()
  })
}

/** Same-process, same-origin loopback controls; not authentication for a shared service. */
export function createEndpointMiddleware(monitor: EndpointMonitorApi, options: Options = {}) {
  const token = options.randomToken?.() ?? randomBytes(32).toString('hex')
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Endpoint session token must contain 32 random bytes.')
  const expectedToken = Buffer.from(token, 'ascii')
  const platform = options.platform ?? process.platform
  const available = (options.enabled ?? true) && platform === 'win32'
  const bodyTimeoutMs = options.bodyTimeoutMs ?? 5_000
  if (!Number.isInteger(bodyTimeoutMs) || bodyTimeoutMs < 1 || bodyTimeoutMs > 5_000) throw new Error('Endpoint body deadline must be between 1 and 5000 milliseconds.')

  return async (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    const pathname = request.url?.split('?')[0] ?? ''
    if (pathname !== '/api/endpoint' && !pathname.startsWith('/api/endpoint/')) { next(); return }
    if (response.destroyed || response.writableEnded) return
    privateHeaders(response)
    const method = PRIVATE_ROUTES.get(pathname)
    if (!method) { fail(response, 404, 'endpoint_not_found', 'Endpoint route not found.'); return }
    const origin = localOrigin(request)
    const requestOrigin = request.headers.origin
    const fetchSite = request.headers['sec-fetch-site']
    if (!origin || forwarded(request) || request.headers[CLIENT_HEADER] !== '1'
      || (requestOrigin !== undefined && requestOrigin !== origin)
      || (fetchSite !== undefined && fetchSite !== 'same-origin')
      || (request.method === 'POST' && requestOrigin !== origin)) {
      fail(response, 403, 'endpoint_local_only', 'PC monitoring is available only from this computer’s local app.'); return
    }
    if (request.method !== method) {
      response.setHeader('allow', method)
      fail(response, 405, 'endpoint_method_not_allowed', 'Method not allowed.'); return
    }
    if (request.url?.includes('?')) { fail(response, 400, 'endpoint_invalid_request', 'Query options are not supported.'); return }
    if (method === 'GET' && (Number(request.headers['content-length'] ?? 0) > 0 || request.headers['transfer-encoding'] !== undefined)) {
      response.setHeader('connection', 'close')
      fail(response, 400, 'endpoint_invalid_request', 'Request bodies are not supported for this route.'); return
    }
    if (pathname === '/api/endpoint/session') { send(response, 200, { token, platform, available }); return }
    const providedToken = request.headers[TOKEN_HEADER]
    if (typeof providedToken !== 'string' || !/^[a-f0-9]{64}$/.test(providedToken)
      || !timingSafeEqual(Buffer.from(providedToken, 'ascii'), expectedToken)) {
      fail(response, 403, 'endpoint_session_required', 'Reconnect to the local monitoring session.'); return
    }
    if (!available) { fail(response, 503, 'endpoint_unavailable', 'Run the local app on Windows to use PC monitoring.'); return }
    try {
      if (pathname === '/api/endpoint/status') { send(response, 200, monitor.getSnapshot()); return }
      const contentType = request.headers['content-type']
      if (typeof contentType !== 'string' || !/^application\/json(?:\s*;\s*charset="?utf-8"?)?$/i.test(contentType)) {
        response.setHeader('connection', 'close')
        fail(response, 415, 'endpoint_json_required', 'Send a JSON request.'); return
      }
      let text: string
      try { text = await body(request, bodyTimeoutMs) }
      catch (error) {
        response.setHeader('connection', 'close')
        fail(response, error instanceof RangeError ? 413 : 400, 'endpoint_invalid_request', 'The request is invalid or exceeds the 1 KiB limit.'); return
      }
      // The fixed request grammar also rejects duplicate keys and arbitrary command inputs.
      if (pathname === '/api/endpoint/start') {
        const match = /^[ \t\r\n]*\{[ \t\r\n]*"includeSysmon"[ \t\r\n]*:[ \t\r\n]*(true|false)[ \t\r\n]*\}[ \t\r\n]*$/.exec(text)
        if (!match) { fail(response, 400, 'endpoint_invalid_request', 'Choose a boolean Include existing Sysmon option.'); return }
        send(response, 200, await monitor.start({ includeSysmon: match[1] === 'true' }))
      } else {
        if (!/^[ \t\r\n]*\{[ \t\r\n]*\}[ \t\r\n]*$/.test(text)) { fail(response, 400, 'endpoint_invalid_request', 'Stop accepts no options.'); return }
        send(response, 200, monitor.stop())
      }
    } catch {
      fail(response, 503, 'endpoint_check_failed', 'The local monitoring request could not complete. Retry or check the source coverage.');
    }
  }
}
