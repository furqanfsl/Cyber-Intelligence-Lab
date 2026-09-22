import assert from 'node:assert/strict'
import test from 'node:test'
import { CISA_NAME, CISA_URL, NEWS_NAME, NEWS_QUERIES, NEWS_URLS, isAllowedSourceUrl } from '../../server/sources.ts'
import * as contract from '../../shared/live-intel.ts'

test('the fixed source registry cannot be extended or redirected by a consumer', () => {
  assert.equal(Object.isFrozen(NEWS_QUERIES), true)
  assert.equal(Object.isFrozen(NEWS_URLS), true)
  assert.throws(() => { (NEWS_URLS as string[])[0] = 'https://attacker.example/' }, TypeError)
  assert.throws(() => { (NEWS_URLS as string[]).push('http://localhost/') }, TypeError)
  assert.ok([CISA_URL, ...NEWS_URLS].every(isAllowedSourceUrl))
  for (const url of ['https://attacker.example/', 'http://localhost/', `${CISA_URL}#fragment`]) {
    assert.equal(isAllowedSourceUrl(url), false)
  }
  assert.equal(CISA_NAME, contract.CISA_NAME)
  assert.equal(NEWS_NAME, contract.NEWS_NAME)
})
