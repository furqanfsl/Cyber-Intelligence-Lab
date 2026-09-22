import { ALLOWED_SOURCE_URLS } from './sources.ts'

export type JsonLoader = (url: string) => Promise<unknown>
type FetchOptions = { fetchImpl?: typeof fetch; timeoutMs?: number; maxBytes?: number }

/** Bound both download size and duration, and never follow off-allowlist redirects. */
export function createJsonLoader({ fetchImpl = fetch, timeoutMs = 9_000, maxBytes = 5 * 1_024 * 1_024 }: FetchOptions = {}): JsonLoader {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) {
    throw new RangeError('timeoutMs must be a positive supported timer interval')
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new RangeError('maxBytes must be a positive safe integer')
  }
  return async (url) => {
    if (!ALLOWED_SOURCE_URLS.has(url)) throw new Error('Source URL is not allowed')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchImpl(url, {
        headers: { accept: 'application/json', 'user-agent': 'CyberIntelligenceLab/1.0 defensive-portfolio-project' },
        signal: controller.signal,
        redirect: 'error',
      })
      if (!response.ok) {
        await response.body?.cancel()
        throw new Error('Source request failed')
      }
      const advertisedSize = Number(response.headers.get('content-length'))
      if (Number.isFinite(advertisedSize) && advertisedSize > maxBytes) {
        await response.body?.cancel()
        throw new Error('Source response exceeded size limit')
      }
      if (!response.body) throw new Error('Source returned an empty response')
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > maxBytes) {
            await reader.cancel()
            throw new Error('Source response exceeded size limit')
          }
          chunks.push(value)
        }
      } finally {
        reader.releaseLock()
      }
      const bytes = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.byteLength
      }
      // Reject corrupt UTF-8 rather than silently replacing bytes inside record identifiers.
      // TextDecoder consumes a leading UTF-8 BOM, matching common JSON feed behavior.
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
    } finally {
      clearTimeout(timeout)
    }
  }
}
