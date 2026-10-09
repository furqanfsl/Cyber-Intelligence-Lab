import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { isLiveIntelPayload } from '../src/lib/live-intel.ts'
import { PROJECT_ROOT } from './dev.mjs'
import { previewIdentity } from '../server/preview-identity.ts'

const preview = 'http://127.0.0.1:5173/'
const goLive = 'http://127.0.0.1:5500/'

export async function verifyLocal({ includeGoLive = false, fetcher = fetch, log = console.log } = {}) {
  async function get(url, type, headers) {
    let response
    try {
      response = await fetcher(url, {
        signal: AbortSignal.timeout(20_000), cache: 'no-store', redirect: 'error', headers,
      })
    } catch (cause) {
      const guidance = url.startsWith(goLive)
        ? 'Start the VS Code Live Server extension for this folder. Restart it after settings changes.'
        : 'Start this project with start.bat or npm run dev and keep its terminal open.'
      throw new Error(`${url}: could not connect or complete the request. ${guidance}`, { cause })
    }
    assert.ok(response.ok, `${url}: HTTP ${response.status}`)
    assert.match(response.headers.get('content-type') ?? '', type, `${url}: wrong content type`)
    return response
  }
  const response = await get(preview, /text\/html/, { Origin: goLive.slice(0, -1) })
  const html = await response.text()
  assert.equal(response.headers.get('x-cyber-lab-preview'), previewIdentity(PROJECT_ROOT), 'Port 5173 belongs to a different checkout or an old preview. Stop its terminal and restart this project.')
  assert.ok(html.includes('<title>Cyber Intelligence Lab</title>') && html.includes('/@vite/client'), 'Port 5173 is not this project’s Vite preview.')
  assert.equal(response.headers.get('access-control-allow-origin'), goLive.slice(0, -1), 'Go Live readiness check needs loopback CORS access.')
  const entry = await (await get(`${preview}src/main.tsx`, /(?:java|ecma)script/)).text()
  assert.ok(entry.includes('createRoot') && !entry.includes('<App />'), 'The React entry was not transformed.')
  const font = await (await get(`${preview}fonts/Manrope-Variable.woff2`, /font\/woff2/)).arrayBuffer()
  assert.ok(font.byteLength > 100, 'The local font is empty.')
  const payload = await (await get(`${preview}api/live-intel`, /application\/json/)).json()
  assert.ok(isLiveIntelPayload(payload), 'The live intelligence API returned an invalid payload.')
  log(`PASS ${preview} — app, transformed entry, local font and API contract`)
  log(`Source health (not a startup gate): ${payload.sources.map((source) => `${source.name}: ${source.status}`).join(', ')}`)
  if (includeGoLive) {
    const launcher = await (await get(goLive, /text\/html/)).text()
    assert.ok(launcher.includes('id="launch-status"') && launcher.includes('/launch.js'), 'Go Live still has the old settings. Stop Port: 5500, then click Go Live again.')
    await get(`${goLive}launch.css`, /text\/css/)
    const script = await (await get(`${goLive}launch.js`, /(?:java|ecma)script/)).text()
    assert.ok(script.includes(preview) && script.includes('location.replace'), 'Go Live handoff script is missing or points at the wrong port.')
    log(`PASS ${goLive} — independent startup page and handoff assets`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    assert.ok(process.argv.slice(2).every((argument) => argument === '--go-live'), 'Usage: npm run verify:local [-- --go-live]')
    await verifyLocal({ includeGoLive: process.argv.includes('--go-live') })
  } catch (error) {
    console.error(`Preview verification failed: ${error.message}\nStart the app with start.bat or npm run dev, then retry. Keep its terminal open.`)
    process.exitCode = 1
  }
}
