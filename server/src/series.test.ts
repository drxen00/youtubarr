import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compileRules, matchSeries } from './series.ts'

test('matchSeries picks the highest-priority matching rule', () => {
  const rules = compileRules([
    { seriesId: 1, seriesPriority: 0, pattern: 'minecraft', flags: 'i' },
    { seriesId: 2, seriesPriority: 10, pattern: 'meme review', flags: 'i' },
  ])
  assert.equal(matchSeries('Minecraft Part 1', rules), 1)
  assert.equal(matchSeries('MEME REVIEW but in Minecraft', rules), 2)
  assert.equal(matchSeries('Some unrelated vlog', rules), null)
})

test('compileRules skips invalid regexes instead of throwing', () => {
  const rules = compileRules([
    { seriesId: 1, seriesPriority: 0, pattern: '(', flags: 'i' },
    { seriesId: 2, seriesPriority: 0, pattern: 'amnesia', flags: 'i' },
  ])
  assert.equal(rules.length, 1)
  assert.equal(matchSeries('Amnesia: Justine', rules), 2)
})

test('rules honour per-rule flags (case-sensitive short names)', () => {
  const rules = compileRules([{ seriesId: 7, seriesPriority: 0, pattern: '\\bIb\\b', flags: '' }])
  assert.equal(matchSeries('Ib - Part 3', rules), 7)
  assert.equal(matchSeries('IB IS NOT THE GAME', rules), null)
})
