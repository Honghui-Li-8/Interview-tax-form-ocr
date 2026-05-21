import { describe, expect, test, vi } from 'vitest'
import type { TaxReturnExtraction } from '../../../shared/types'
import { makeProcessHandler } from './processHandler'
import { mergeParsedForms } from './taxPacketMergeService'

const { parseTaxReturnPacket } = vi.hoisted(() => ({
  parseTaxReturnPacket: vi.fn(),
}))

vi.mock('./claudeTaxParserService', () => ({
  parseTaxReturnPacket,
}))

function makeReq(id = '1', username = 'alice') {
  return {
    params: { id },
    user: { username },
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

function packet(): TaxReturnExtraction {
  return {
    ...mergeParsedForms([], {}),
    summary: {
      taxpayerName: 'Ada Lovelace',
      filingStatus: 'Single',
      totalIncome: '1234',
      totalTax: '120',
      refundOrOwed: '20',
    },
  }
}

describe('makeProcessHandler packet parser wiring', () => {
  test('persists packet-shaped encrypted extraction on parser success', async () => {
    parseTaxReturnPacket.mockResolvedValueOnce(packet())
    const calls: Array<{ sql: string; params: unknown[] }> = []
    const db = {
      get: async () => ({ id: 1, stored_path: '/tmp/return.pdf', status: 'pending' }),
      run: async (sql: string, params: unknown[]) => {
        calls.push({ sql, params })
        return { changes: 1 }
      },
    }
    const res = makeRes()

    await makeProcessHandler(db as never)(makeReq() as never, res as never)

    expect(parseTaxReturnPacket).toHaveBeenCalledWith('/tmp/return.pdf')
    expect(calls[1].params[1]).toBe('extracted')
    expect(String(calls[1].params[0])).toContain('__encryptedJson')
    expect(res.body).toMatchObject({
      documentId: 1,
      status: 'extracted',
      fields: {
        taxpayerName: 'Ada Lovelace',
        filingStatus: 'Single',
        totalWages: '1234',
        totalTax: '120',
        refundOrOwed: '20',
      },
    })
    expect((res.body as { extraction: TaxReturnExtraction }).extraction.schemaVersion).toBe(1)
  })

  test('sets failed status and returns packet-shaped extraction on parser failure', async () => {
    parseTaxReturnPacket.mockRejectedValueOnce(new Error('missing api key'))
    const calls: Array<{ sql: string; params: unknown[] }> = []
    const db = {
      get: async () => ({ id: 1, stored_path: '/tmp/return.pdf', status: 'pending' }),
      run: async (sql: string, params: unknown[]) => {
        calls.push({ sql, params })
        return { changes: 1 }
      },
    }
    const res = makeRes()

    await makeProcessHandler(db as never)(makeReq() as never, res as never)

    expect(calls[1].params[1]).toBe('failed')
    expect((res.body as { extraction: TaxReturnExtraction }).extraction.warnings)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'PARSER_FAILED', severity: 'error' }),
      ]))
  })
})
