import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { TaxReturnExtraction } from '../../../shared/types'
import { makeProcessHandler } from './processHandler'
import { mergeParsedForms } from './taxPacketMergeService'
import { clearProcessingProgress, getLatestProcessingProgress } from './processingProgressService'
import { resetProcessingJobSlotsForTest } from './processingJobSlots'

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
  beforeEach(() => {
    delete process.env.MAX_ACTIVE_PROCESSING_JOBS
    process.env.MASTER_ENCRYPTION_KEY = 'test-key'
    parseTaxReturnPacket.mockReset()
    resetProcessingJobSlotsForTest()
  })

  test('starts processing asynchronously for pending documents', async () => {
    clearProcessingProgress(1)
    let resolveParser!: (value: TaxReturnExtraction) => void
    parseTaxReturnPacket.mockReturnValueOnce(new Promise(resolve => {
      resolveParser = resolve
    }))
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

    expect(res.statusCode).toBe(202)
    expect(res.body).toEqual({
      documentId: 1,
      status: 'processing',
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].params[0]).toBe('processing')
    expect(parseTaxReturnPacket).toHaveBeenCalledWith('/tmp/return.pdf', expect.objectContaining({
      onProgress: expect.any(Function),
    }))
    expect(calls).toHaveLength(1)

    resolveParser(packet())

    await vi.waitFor(() => {
      expect(calls).toHaveLength(2)
    })
    expect(calls[1].params[1]).toBe('extracted')
    expect(String(calls[1].params[0])).toContain('__encryptedJson')
    expect(getLatestProcessingProgress(1)).toMatchObject({
      documentId: 1,
      phase: 'completed',
      percent: 100,
    })
  })

  test('sets failed status when background parser fails', async () => {
    clearProcessingProgress(1)
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

    expect(res.statusCode).toBe(202)
    expect(res.body).toEqual({
      documentId: 1,
      status: 'processing',
    })

    await vi.waitFor(() => {
      expect(calls[1].params[1]).toBe('failed')
      expect(getLatestProcessingProgress(1)).toMatchObject({
        documentId: 1,
        phase: 'failed',
        warningCodes: expect.arrayContaining(['PARSER_FAILED']),
      })
    })
  })

  test('returns processing for processing document without starting another job', async () => {
    const db = {
      get: async () => ({ id: 1, stored_path: '/tmp/return.pdf', status: 'processing' }),
      run: vi.fn(),
    }
    const res = makeRes()

    await makeProcessHandler(db as never)(makeReq() as never, res as never)

    expect(res.statusCode).toBe(202)
    expect(res.body).toEqual({
      documentId: 1,
      status: 'processing',
    })
    expect(parseTaxReturnPacket).not.toHaveBeenCalled()
    expect(db.run).not.toHaveBeenCalled()
  })

  test('returns terminal status without restarting processing', async () => {
    const db = {
      get: async () => ({ id: 1, stored_path: '/tmp/return.pdf', status: 'extracted' }),
      run: vi.fn(),
    }
    const res = makeRes()

    await makeProcessHandler(db as never)(makeReq() as never, res as never)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({
      documentId: 1,
      status: 'extracted',
    })
    expect(parseTaxReturnPacket).not.toHaveBeenCalled()
    expect(db.run).not.toHaveBeenCalled()
  })

  test('rejects additional pending documents when the active limit is reached', async () => {
    clearProcessingProgress(1)
    clearProcessingProgress(2)
    let resolveFirstParser!: (value: TaxReturnExtraction) => void
    parseTaxReturnPacket
      .mockReturnValueOnce(new Promise(resolve => {
        resolveFirstParser = resolve
      }))
      .mockResolvedValueOnce(packet())

    const docs = new Map([
      [1, { id: 1, stored_path: '/tmp/first.pdf', status: 'pending' }],
      [2, { id: 2, stored_path: '/tmp/second.pdf', status: 'pending' }],
    ])
    const calls: Array<{ sql: string; params: unknown[] }> = []
    const db = {
      get: async (_sql: string, params: unknown[]) => {
        const id = Number(params[0])
        return docs.get(id)
      },
      run: async (sql: string, params: unknown[]) => {
        calls.push({ sql, params })
        const id = Number(params[1])
        if (params[0] === 'processing') {
          docs.set(id, { ...docs.get(id)!, status: 'processing' })
        }
        return { changes: 1 }
      },
    }
    const firstRes = makeRes()
    const secondRes = makeRes()

    await makeProcessHandler(db as never)(makeReq('1') as never, firstRes as never)
    await makeProcessHandler(db as never)(makeReq('2') as never, secondRes as never)

    expect(firstRes.statusCode).toBe(202)
    expect(secondRes.statusCode).toBe(429)
    expect(firstRes.body).toEqual({ documentId: 1, status: 'processing' })
    expect(secondRes.body).toEqual({
      error: 'Another document is already processing. This exercise build limits extraction to one document at a time because PDF parsing and Claude extraction are resource-intensive on modest hosting. Try again after it finishes.',
    })
    expect(docs.get(2)?.status).toBe('pending')
    expect(calls.filter(call => call.params[0] === 'processing')).toHaveLength(1)
    expect(parseTaxReturnPacket).toHaveBeenCalledTimes(1)
    expect(parseTaxReturnPacket).toHaveBeenCalledWith('/tmp/first.pdf', expect.objectContaining({
      onProgress: expect.any(Function),
    }))

    resolveFirstParser(packet())

    await vi.waitFor(() => {
      expect(getLatestProcessingProgress(1)).toMatchObject({
        documentId: 1,
        phase: 'completed',
        percent: 100,
      })
    })

    await makeProcessHandler(db as never)(makeReq('2') as never, secondRes as never)

    await vi.waitFor(() => {
      expect(parseTaxReturnPacket).toHaveBeenCalledTimes(2)
    })
    expect(secondRes.statusCode).toBe(202)
    expect(secondRes.body).toEqual({ documentId: 2, status: 'processing' })
    expect(calls.filter(call => call.params[0] === 'processing')).toHaveLength(2)
  })
})
