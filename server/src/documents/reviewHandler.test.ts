import { describe, expect, test } from 'vitest'
import { validateAcceptedFields } from './reviewHandler'

const VALID_FIELDS = {
  taxpayerName: 'Billie J. Does',
  filingStatus: 'Single',
  totalWages: '39,027',
  totalTax: '2,978',
  refundOrOwed: '147',
}

describe('validateAcceptedFields', () => {
  test('accepts valid reviewed fields and trims values', () => {
    const result = validateAcceptedFields({
      ...VALID_FIELDS,
      taxpayerName: '  Billie J. Does  ',
    })

    expect(result).toEqual({
      fields: {
        ...VALID_FIELDS,
        taxpayerName: 'Billie J. Does',
      },
    })
  })

  test('rejects missing required fields', () => {
    const result = validateAcceptedFields({
      ...VALID_FIELDS,
      totalTax: '',
    })

    expect(result).toEqual({ error: 'totalTax is required' })
  })

  test('rejects invalid filing status', () => {
    const result = validateAcceptedFields({
      ...VALID_FIELDS,
      filingStatus: 'Joint',
    })

    expect(result).toEqual({ error: 'Filing status is invalid' })
  })

  test('rejects invalid money values', () => {
    const result = validateAcceptedFields({
      ...VALID_FIELDS,
      refundOrOwed: 'one hundred',
    })

    expect(result).toEqual({ error: 'refundOrOwed must be a valid dollar amount' })
  })

  test('rejects non-object payloads', () => {
    expect(validateAcceptedFields(null)).toEqual({ error: 'Fields must be an object' })
    expect(validateAcceptedFields([])).toEqual({ error: 'Fields must be an object' })
  })
})
