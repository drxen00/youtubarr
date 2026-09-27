import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanTitle, leadingSegment, suggestSeries } from './detect.ts'

test('cleanTitle strips episode markers and bracketed tags', () => {
  assert.equal(cleanTitle('Minecraft Hardcore #12'), 'Minecraft Hardcore')
  assert.equal(cleanTitle('GTA V - Part 3 (Gameplay) [HD]'), 'GTA V')
  assert.equal(cleanTitle('Subnautica | Ep. 4 | Big Fish'), 'Subnautica | Big Fish')
  assert.equal(cleanTitle('Amnesia: Custom Story - Part 7'), 'Amnesia: Custom Story')
  assert.equal(cleanTitle('Happy Wheels 44'), 'Happy Wheels')
})

test('leadingSegment picks a label, not a sentence', () => {
  assert.equal(leadingSegment('Minecraft Hardcore'), 'Minecraft Hardcore')
  assert.equal(leadingSegment('Amnesia: Custom Story'), 'Amnesia')
  assert.equal(leadingSegment('I tried the worst game ever made and this happened to me'), null)
  assert.equal(leadingSegment('The and of'), null)
})

test('suggestSeries groups recurring prefixes and ignores one-offs and the channel name', () => {
  const rows = [
    ...Array.from({ length: 6 }, (_, i) => ({ id: `m${i}`, title: `Minecraft Hardcore #${i + 1}` })),
    ...Array.from({ length: 5 }, (_, i) => ({ id: `g${i}`, title: `GTA V - Part ${i + 1} - chaos` })),
    ...Array.from({ length: 4 }, (_, i) => ({ id: `s${i}`, title: `Subnautica | Ep. ${i + 1} | stuff` })),
    ...Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, title: `SomeGuy - random rant ${i}` })),
    { id: 'x1', title: 'My setup tour' },
    { id: 'x2', title: 'Q&A time' },
  ]
  const s = suggestSeries(rows, { minCount: 4, exclude: ['SomeGuy'] })
  const names = s.map((x) => x.name)
  assert.deepEqual(names, ['Minecraft Hardcore', 'GTA V', 'Subnautica'])
  assert.equal(s[0]!.count, 6)
  // The generated regex reproduces the grouping.
  const re = new RegExp(s[0]!.pattern, 'i')
  assert.ok(re.test('Minecraft Hardcore #99'))
  assert.ok(!re.test('Minecraft Survival #1'))
})
