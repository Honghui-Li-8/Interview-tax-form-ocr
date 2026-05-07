import { describe, expect, test } from 'vitest'
import { makeReviewHandlers } from './reviewHandler'
import { makeProcessHandler } from './processHandler'

type DbCall = {
  sql: string
  params: unknown[]
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

describe('document ownership guards', () => {
  test('review lookup filters by authenticated owner', async () => {
    const calls: DbCall[] = []
    const db = {
      get: async (sql: string, params: unknown[]) => {
        calls.push({ sql, params })
        return undefined
      },
    }

    const { getDocument } = makeReviewHandlers(db as never)
    const res = makeRes()

    await getDocument(makeReq('7', 'bob') as never, res as never)

    expect(res.statusCode).toBe(404)
    expect(calls[0].sql).toContain('owner_username = ?')
    expect(calls[0].params).toEqual([7, 'bob'])
  })

  test('accept lookup and update filter by authenticated owner', async () => {
    const calls: DbCall[] = []
    const db = {
      get: async (sql: string, params: unknown[]) => {
        calls.push({ sql, params })
        return calls.length === 1
          ? { status: 'extracted' }
          : { accepted_at: '2026-05-06 19:00:00' }
      },
      run: async (sql: string, ...params: unknown[]) => {
        calls.push({ sql, params })
        return { changes: 1 }
      },
    }

    const { acceptDocument } = makeReviewHandlers(db as never)
    const res = makeRes()

    await acceptDocument(makeReq('9', 'alice', {
      fields: {
        taxpayerName: 'Billie J. Does',
        filingStatus: 'Single',
        totalWages: '39,027',
        totalTax: '2,978',
        refundOrOwed: '147',
      },
    }) as never, res as never)

    expect(res.statusCode).toBe(200)
    expect(calls[0].sql).toContain('owner_username = ?')
    expect(calls[0].params).toEqual([9, 'alice'])
    expect(calls[1].sql).toContain('owner_username = ?')
    expect(calls[1].params[calls[1].params.length - 1]).toBe('alice')
    expect(calls[2].sql).toContain('owner_username = ?')
    expect(calls[2].params).toEqual([9, 'alice'])
  })

  test('accepted record list filters by authenticated owner', async () => {
    const calls: DbCall[] = []
    const db = {
      all: async (sql: string, params: unknown[]) => {
        calls.push({ sql, params })
        return []
      },
    }

    const { listAcceptedDocuments } = makeReviewHandlers(db as never)
    const res = makeRes()

    await listAcceptedDocuments(makeReq('1', 'carol') as never, res as never)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ records: [] })
    expect(calls[0].sql).toContain('owner_username = ?')
    expect(calls[0].sql).toContain("status = 'accepted'")
    expect(calls[0].params).toEqual(['carol'])
  })

  test('process lookup and claim filter by authenticated owner', async () => {
    const calls: DbCall[] = []
    const db = {
      get: async (sql: string, params: unknown[]) => {
        calls.push({ sql, params })
        return undefined
      },
      run: async (sql: string, params: unknown[]) => {
        calls.push({ sql, params })
        return { changes: 0 }
      },
    }

    const handleProcess = makeProcessHandler(db as never)
    const res = makeRes()

    await handleProcess(makeReq('11', 'bob') as never, res as never)

    expect(res.statusCode).toBe(404)
    expect(calls[0].sql).toContain('owner_username = ?')
    expect(calls[0].params).toEqual([11, 'bob'])
  })
})
