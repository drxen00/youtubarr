import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseChannelInput, parseDuration } from './youtube.ts'

test('parseDuration handles the ISO 8601 shapes YouTube emits', () => {
  assert.equal(parseDuration('PT4M13S'), 253)
  assert.equal(parseDuration('PT1H2M3S'), 3723)
  assert.equal(parseDuration('PT45S'), 45)
  assert.equal(parseDuration('PT2H'), 7200)
  assert.equal(parseDuration('P1DT1H'), 90000)
  assert.equal(parseDuration(undefined), 0)
  assert.equal(parseDuration('garbage'), 0)
})

test('parseChannelInput accepts handles, ids, and URLs', () => {
  assert.deepEqual(parseChannelInput('@PewDiePie'), { handle: '@PewDiePie' })
  assert.deepEqual(parseChannelInput('PewDiePie'), { handle: '@PewDiePie' })
  assert.deepEqual(parseChannelInput('UC-lHJZR3Gqxm24_Vd_AJ5Yw'), { id: 'UC-lHJZR3Gqxm24_Vd_AJ5Yw' })
  assert.deepEqual(parseChannelInput('https://www.youtube.com/@PewDiePie/videos'), { handle: '@PewDiePie' })
  assert.deepEqual(parseChannelInput('https://youtube.com/channel/UC-lHJZR3Gqxm24_Vd_AJ5Yw'), { id: 'UC-lHJZR3Gqxm24_Vd_AJ5Yw' })
  assert.deepEqual(parseChannelInput('youtube.com/user/PewDiePie'), { username: 'PewDiePie' })
  assert.throws(() => parseChannelInput('https://vimeo.com/foo'))
})
