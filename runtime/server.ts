import { createReadStream, realpathSync, statSync } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { isIP } from 'node:net'
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createLiveIntelService } from '../server/live-intel.ts'
import { createLiveIntelMiddleware } from '../server/middleware.ts'

type Middleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => void | Promise<void>
type ServerOptions = { distDir?: string; liveIntelMiddleware?: Middleware }
const DEFAULT_DIST = fileURLToPath(new URL('../dist/', import.meta.url))
// This policy belongs to the production runtime, not Vite's development/HMR server.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'", "script-src 'self'", "script-src-attr 'none'",
  "style-src 'self' 'unsafe-inline'", "style-src-elem 'self'", "style-src-attr 'unsafe-inline'",
  "font-src 'self'", "img-src 'self'", "connect-src 'self'",
  "object-src 'none'", "base-uri 'none'", "frame-src 'none'", "frame-ancestors 'none'", "form-action 'none'",
].join('; ')
const PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), clipboard-write=(self)'
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.avif': 'image/avif', '.gif': 'image/gif',
  '.webmanifest': 'application/manifest+json',
}

function inside(root: string, target: string) {
  const path = relative(root, target)
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)
}

function matchesEntityTag(condition: string | undefined, etag: string) {
  if (condition?.trim() === '*') return true
  // If-None-Match uses weak comparison for both GET and HEAD.
  return condition?.split(',').some((candidate) => candidate.trim().replace(/^W\//, '') === etag.replace(/^W\//, '')) ?? false
}

function acceptsHtml(accept = '') {
  return accept.split(',').some((range) => {
    const [mediaType, ...parameters] = range.toLowerCase().split(';').map((value) => value.trim())
    if (mediaType !== 'text/html') return false
    const quality = parameters.filter((parameter) => parameter.startsWith('q='))
    if (!quality.length) return true
    return quality.length === 1 && /^q=(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(quality[0]) && Number(quality[0].slice(2)) > 0
  })
}

function sendError(request: IncomingMessage, response: ServerResponse, status: number, error: string) {
  if (response.headersSent) {
    response.destroy()
    return
  }
  const body = JSON.stringify({ error })
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  response.end(request.method === 'HEAD' ? undefined : body)
}

/** Create an unbound server; tests inject a source handler rather than using the internet. */
export function createAppServer(options: ServerOptions = {}) {
  let root: string
  try {
    root = realpathSync(options.distDir ?? DEFAULT_DIST)
    const index = realpathSync(join(root, 'index.html'))
    if (!statSync(root).isDirectory() || !statSync(index).isFile() || !inside(root, index)) throw new Error()
  } catch {
    throw new Error('Built app not found. Run npm run build before starting the server.')
  }
  const service = createLiveIntelService()
  const liveIntel = options.liveIntelMiddleware ?? createLiveIntelMiddleware(() => service.get())

  async function handle(request: IncomingMessage, response: ServerResponse) {
    response.setHeader('x-content-type-options', 'nosniff')
    response.setHeader('x-frame-options', 'DENY')
    response.setHeader('referrer-policy', 'no-referrer')
    response.setHeader('content-security-policy', CONTENT_SECURITY_POLICY)
    response.setHeader('permissions-policy', PERMISSIONS_POLICY)
    let pathname: string
    try {
      const raw = request.url ?? '/'
      if (!raw.startsWith('/') || raw.startsWith('//')) throw new Error()
      const encodedPath = raw.split('?')[0]
      // Avoid disagreement with proxies that decode separators before routing.
      if (/%(?:2f|5c)/i.test(encodedPath)) throw new Error()
      pathname = decodeURIComponent(encodedPath)
      // Reject before URL normalization; Windows also treats backslashes, colons and
      // trailing dots/spaces specially. Hidden files never belong to the public app.
      const hasControlCharacter = [...pathname].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
      if (hasControlCharacter || /[\\:#]/.test(pathname)) throw new Error()
      if (pathname.split('/').some((part) => part.startsWith('.') || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
        sendError(request, response, 403, 'Forbidden')
        return
      }
    } catch {
      sendError(request, response, 400, 'Invalid request path')
      return
    }
    const api = pathname === '/api' || pathname.startsWith('/api/')
    const health = pathname === '/healthz' || pathname.startsWith('/healthz/')
    if (health && request.url?.split('?')[0] !== '/healthz') {
      sendError(request, response, 404, 'Health route not found')
      return
    }
    if (api && pathname !== '/api/live-intel') {
      sendError(request, response, 404, 'API route not found')
      return
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('allow', 'GET, HEAD')
      sendError(request, response, 405, 'Method not allowed')
      return
    }
    if (Number(request.headers['content-length'] ?? 0) > 0 || request.headers['transfer-encoding'] !== undefined) {
      // No route consumes a request body. Close instead of retaining unread bytes
      // on a persistent connection or starting unnecessary upstream work.
      response.setHeader('connection', 'close')
      sendError(request, response, 400, 'Request bodies are not supported')
      return
    }
    if (health) {
      // Process readiness is independent of third-party intelligence availability.
      const body = JSON.stringify({ status: 'ok' })
      response.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'content-length': Buffer.byteLength(body),
      })
      response.end(request.method === 'HEAD' ? undefined : body)
      return
    }
    if (api) {
      await liveIntel(request, response, () => sendError(request, response, 404, 'API route not found'))
      return
    }

    let file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`)
    if (!inside(root, file)) {
      sendError(request, response, 403, 'Forbidden')
      return
    }
    try {
      file = await realpath(file)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && (error as NodeJS.ErrnoException).code !== 'ENOTDIR') throw error
      const navigation = acceptsHtml(request.headers.accept)
      if (!navigation || extname(pathname) || pathname.startsWith('/assets/')) {
        sendError(request, response, 404, 'Not found')
        return
      }
      file = await realpath(join(root, 'index.html'))
    }
    // realpath also resolves directory symlinks, preventing escapes from dist.
    if (!inside(root, file)) {
      sendError(request, response, 403, 'Forbidden')
      return
    }
    const info = await stat(file, { bigint: true })
    if (!info.isFile()) {
      sendError(request, response, 404, 'Not found')
      return
    }
    // A weak metadata validator avoids reading the entire asset merely to revalidate it.
    const etag = `W/"${info.size.toString(16)}-${info.mtimeNs.toString(16)}-${info.ctimeNs.toString(16)}"`
    const assetPath = relative(root, file).split(sep).join('/')
    const contentHashedAsset = pathname.startsWith('/assets/') &&
      /^assets\/(?:[^/]+\/)*[^/]+-[A-Za-z0-9_-]{8,}\.(?:js|css|woff2?|ttf|otf|png|jpe?g|svg|webp|avif|gif|ico|wasm)$/.test(assetPath)
    response.setHeader('etag', etag)
    response.setHeader('cache-control', contentHashedAsset ? 'public, max-age=31536000, immutable' : 'no-cache')
    if (matchesEntityTag(request.headers['if-none-match'], etag)) {
      response.writeHead(304)
      response.end()
      return
    }
    response.writeHead(200, {
      'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'content-length': info.size.toString(),
    })
    if (request.method === 'HEAD') {
      response.end()
      return
    }
    const stream = createReadStream(file)
    stream.on('error', () => response.destroy())
    response.once('close', () => stream.destroy())
    stream.pipe(response)
  }

  return createServer({ requestTimeout: 30_000, headersTimeout: 10_000, keepAliveTimeout: 5_000 }, (request, response) => {
    void handle(request, response).catch(() => sendError(request, response, 500, 'Unable to serve request'))
  })
}

export function readListenOptions(env: NodeJS.ProcessEnv = process.env) {
  const rawPort = env.PORT ?? '3000'
  const port = Number(rawPort)
  if (!/^\d+$/.test(rawPort) || !Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.')
  }
  const host = env.HOST ?? '127.0.0.1'
  if (host !== 'localhost' && !isIP(host)) throw new Error('HOST must be localhost or a valid IP address.')
  return { host, port }
}

export function installShutdownHandlers(server: Server) {
  let closing = false
  function shutdown() {
    if (closing) return
    closing = true
    const deadline = setTimeout(() => server.closeAllConnections(), 10_000)
    deadline.unref()
    server.close(() => clearTimeout(deadline))
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
  server.once('close', () => {
    process.removeListener('SIGINT', shutdown)
    process.removeListener('SIGTERM', shutdown)
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { host, port } = readListenOptions()
    const server = createAppServer()
    server.once('error', () => {
      console.error('Unable to start the server. Check HOST, PORT and whether the port is already in use.')
      process.exitCode = 1
    })
    server.listen(port, host, () => {
      const displayHost = host.includes(':') ? `[${host}]` : host
      console.log(`Cyber Intelligence Lab running at http://${displayHost}:${port}`)
      installShutdownHandlers(server)
    })
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Unable to start the server.')
    process.exitCode = 1
  }
}
