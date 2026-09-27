import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hashPassword, verifyPassword, validPassword, validUsername } from './users.ts'

test('scrypt hashes verify and are salted', () => {
  const a = hashPassword('correct horse')
  const b = hashPassword('correct horse')
  assert.notEqual(a, b)
  assert.ok(verifyPassword('correct horse', a))
  assert.ok(verifyPassword('correct horse', b))
  assert.ok(!verifyPassword('wrong', a))
  assert.ok(!verifyPassword('correct horse', 'garbage'))
})

test('username and password validation', () => {
  assert.ok(validUsername('pewds_fan-2'))
  assert.ok(!validUsername('a'))
  assert.ok(!validUsername('has space'))
  assert.ok(validPassword('12345678'))
  assert.ok(!validPassword('short'))
})
