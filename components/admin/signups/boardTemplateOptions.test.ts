import assert from 'node:assert/strict'
import test from 'node:test'
import { categoriesToOptions, categoryKey } from './boardTemplateOptions.ts'

test('builds a stable key from a Danish category name', () => {
  assert.equal(categoryKey('Hold klubmesterskab'), 'hold_klubmesterskab')
  assert.equal(categoryKey('ÆØÅ'), 'aeoeaa')
})

test('saves categories as Discord button options and skips blank rows', () => {
  const options = categoriesToOptions([
    { emoji: '🇦', label: ' Division A ', value: '' },
    { emoji: '', label: '', value: '' },
    { emoji: '', label: 'B', value: 'b' },
  ])
  assert.deepEqual(options, [
    { emoji: '🇦', label: 'Division A', value: 'division_a' },
    { label: 'B', value: 'b' },
  ])
})

test('rejects two categories that would share a key', () => {
  assert.throws(
    () => categoriesToOptions([
      { emoji: '', label: 'A', value: '' },
      { emoji: '', label: 'A', value: '' },
    ]),
    /use the key "a"/,
  )
})

test('requires at least one named category', () => {
  assert.throws(
    () => categoriesToOptions([{ emoji: '', label: '  ', value: '' }]),
    /at least one category/,
  )
})
