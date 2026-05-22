import { beforeEach, describe, expect, test } from 'vitest'
import { makeReviewHandlers, validateAcceptedFields } from './reviewHandler'

const VALID_FIELDS = {
  taxpayerName: 'Billie J. Does',
  filingStatus: 'Single',
  totalWages: '39,027',
  totalTax: '2,978',
  refundOrOwed: '147',
}

function makeReq(id = '1', username = 'alice', body: unknown = {}) {
  return {
    params: { id },
    user: { username },
    body,
  }
}

function makeRes() {
  return {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(payload: unknown) {
      this.body = payload
      return this
    },
  }
}

beforeEach(() => {
  process.env.MASTER_ENCRYPTION_KEY = 'test-master-key'
})

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

describe('review decryption failures', () => {
  test('accepted record list skips rows encrypted with an unavailable key', async () => {
    const db = {
      all: async () => [
        {
          id: 7,
          filename: 'old-return.pdf',
          extracted_fields: JSON.stringify({ __encryptedJson: 'not-valid-ciphertext' }),
          accepted_at: '2026-05-22T12:00:00.000Z',
        },
      ],
    }
    const { listAcceptedDocuments } = makeReviewHandlers(db as never)
    const res = makeRes()

    await listAcceptedDocuments(makeReq() as never, res as never)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({
      records: [],
      warnings: [
        expect.objectContaining({
          id: 7,
          filename: 'old-return.pdf',
          code: 'DECRYPTION_FAILED',
        }),
      ],
    })
  })

  test('document lookup returns JSON conflict when stored extraction cannot be decrypted', async () => {
    const db = {
      get: async () => ({
        id: 7,
        status: 'accepted',
        extracted_fields: JSON.stringify({ __encryptedJson: 'not-valid-ciphertext' }),
        accepted_at: '2026-05-22T12:00:00.000Z',
      }),
    }
    const { getDocument } = makeReviewHandlers(db as never)
    const res = makeRes()

    await getDocument(makeReq('7') as never, res as never)

    expect(res.statusCode).toBe(409)
    expect(res.body).toEqual({
      error: 'Saved extraction cannot be decrypted with the current encryption key.',
      code: 'DECRYPTION_FAILED',
    })
  })
})
