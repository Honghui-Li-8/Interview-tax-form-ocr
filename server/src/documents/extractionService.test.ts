import { describe, test, expect } from 'vitest'
import { extractFields, getDemoFields } from './extractionService'

const SAMPLE_OCR = `
Your first name and initial
Jane A. Smith

Filing status
Single

Wages, salaries, tips, etc.
72,500

Total tax
8,342

Amount refunded to you
1,204
`

describe('extractFields', () => {
  test('parses all 5 fields from sample OCR text', () => {
    const fields = extractFields(SAMPLE_OCR)
    expect(fields.taxpayerName).toBe('Jane A. Smith')
    expect(fields.filingStatus).toBe('Single')
    expect(fields.totalWages).toBe('72,500')
    expect(fields.totalTax).toBe('8,342')
    expect(fields.refundOrOwed).toBe('1,204')
  })

  test('returns all null for empty input', () => {
    const fields = extractFields('')
    expect(Object.values(fields).every(v => v === null)).toBe(true)
  })
})

describe('getDemoFields', () => {
  test('returns all five fields as non-null strings', () => {
    const fields = getDemoFields()
    expect(Object.values(fields).every(v => typeof v === 'string' && v.length > 0)).toBe(true)
  })
})
