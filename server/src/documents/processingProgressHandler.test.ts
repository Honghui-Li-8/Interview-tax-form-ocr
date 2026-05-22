import { describe, expect, test } from 'vitest'
import { makeProcessingProgressHandler } from './processingProgressHandler'
import { clearProcessingProgress, emitProcessingProgress } from './processingProgressService'

type DbCall = {
  sql: string
  params: unknown[]
}

function makeReq(id = '1', username = 'alice') {
  return {
    params: { id },
    user: { username },
  }
}

function makeRes() {
  const listeners: Record<string, Array<() => void>> = {}
  return {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    chunks: [] as string[],
    on(event: string, listener: () => void) {
      listeners[event] = [...(listeners[event] ?? []), listener]
      return this
    },
    emitClose() {
      for (const listener of listeners.close ?? []) listener()
    },
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(payload: unknown) {
      this.body = payload
      return this
    },
    setHeader(key: string, value: string) {
      this.headers[key] = value
    },
    flushHeaders() {},
    write(chunk: string) {
      this.chunks.push(chunk)
      return true
    },
  }
}

describe('processing progress handler', () => {
  test('filters progress stream access by authenticated owner', async () => {
    const calls: DbCall[] = []
    const db = {
      get: async (sql: string, params: unknown[]) => {
        calls.push({ sql, params })
        return undefined
      },
    }
    const req = makeReq('7', 'bob')
    const res = makeRes()

    await makeProcessingProgressHandler(db as never)(req as never, res as never)

    expect(res.statusCode).toBe(404)
    expect(calls[0].sql).toContain('owner_username = ?')
    expect(calls[0].params).toEqual([7, 'bob'])
  })

  test('streams latest and future progress events as NDJSON', async () => {
    clearProcessingProgress(8)
    const latest = emitProcessingProgress(8, { phase: 'claiming', message: 'Claiming document' })
    const db = {
      get: async () => ({ id: 8 }),
    }
    const req = makeReq('8', 'alice')
    const res = makeRes()

    await makeProcessingProgressHandler(db as never)(req as never, res as never)
    const next = emitProcessingProgress(8, { phase: 'completed', message: 'Completed' })
    res.emitClose()

    expect(res.headers['Content-Type']).toBe('application/x-ndjson')
    expect(res.headers['X-Accel-Buffering']).toBe('no')
    expect(res.chunks.filter(chunk => chunk.trim()).map(chunk => JSON.parse(chunk))).toEqual([latest, next])
  })
})
