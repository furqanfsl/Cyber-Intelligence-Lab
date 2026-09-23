import assert from 'node:assert/strict'
import test from 'node:test'
import { CISA_NAME, CISA_URL, MSRC_NAME, MSRC_URL, NEWS_NAME, NEWS_QUERIES, NEWS_URLS, isAllowedSourceUrl } from '../../server/sources.ts'
import * as contract from '../../shared/live-intel.ts'

test('the fixed source registry cannot be extended or redirected by a consumer', () => {
  assert.equal(Object.isFrozen(NEWS_QUERIES), true)
  assert.equal(Object.isFrozen(NEWS_URLS), true)
  assert.throws(() => { (NEWS_URLS as string[])[0] = 'https://attacker.example/' }, TypeError)
  assert.throws(() => { (NEWS_URLS as string[]).push('http://localhost/') }, TypeError)
  assert.ok([CISA_URL, ...NEWS_URLS, MSRC_URL].every(isAllowedSourceUrl))
  for (const url of ['https://attacker.example/', 'http://localhost/', `${CISA_URL}#fragment`, `${MSRC_URL}?host=example.com`, MSRC_URL.replace('https:', 'http:'), MSRC_URL.replace('api.msrc.microsoft.com', 'api.msrc.microsoft.com.example.com')]) {
    assert.equal(isAllowedSourceUrl(url), false)
  }
  assert.equal(CISA_NAME, contract.CISA_NAME)
  assert.equal(NEWS_NAME, contract.NEWS_NAME)
  assert.equal(MSRC_NAME, contract.MSRC_NAME)
})

test('MSRC release links require an exact trusted HTTPS path and genuine release ID shape', () => {
  for (const id of ['2026-Sep', '2018-FEB', '2017-May-B']) {
    assert.equal(contract.isMsrcAdvisoryId(id), true)
    assert.equal(contract.isMsrcAdvisoryLink(id, `https://msrc.microsoft.com/update-guide/releaseNote/${id}`), true)
  }
  for (const id of [null, 2026, '', '2026-13', '2026-January', '../2026-Sep', '2026-Sep?x=1', '2026-Sep\n']) {
    assert.equal(contract.isMsrcAdvisoryId(id), false)
  }
  const id = '2026-Sep'
  for (const url of [
    `http://msrc.microsoft.com/update-guide/releaseNote/${id}`,
    `https://msrc.microsoft.com.example.com/update-guide/releaseNote/${id}`,
    `https://msrc.microsoft.com/update-guide/releaseNote/${id}?redirect=example.com`,
    'https://msrc.microsoft.com/update-guide/releaseNote/2026-Aug',
    'javascript:alert(1)',
  ]) assert.equal(contract.isMsrcAdvisoryLink(id, url), false)
})
