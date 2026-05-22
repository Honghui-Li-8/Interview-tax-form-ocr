import { Request, Response } from 'express'
import { Database } from 'sqlite'
import { getAuthUser } from '../auth/authMiddleware'
import { subscribeProcessingProgress } from './processingProgressService'
import type { ProcessingProgressEvent } from '../../../shared/types'

type TaxDocumentRow = { id: number }

function writeProgressEvent(res: Response, event: ProcessingProgressEvent): void {
  res.write(`${JSON.stringify(event)}\n`)
}

export function makeProcessingProgressHandler(db: Database) {
  return async function handleProcessingProgress(req: Request, res: Response): Promise<void> {
    const { username } = getAuthUser(req)
    const id = parseInt(String(req.params.id), 10)
    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid document ID' })
      return
    }

    const doc = await db.get<TaxDocumentRow>(
      'SELECT id FROM tax_documents WHERE id = ? AND owner_username = ?',
      [id, username]
    )

    if (!doc) {
      res.status(404).json({ error: 'Not found' })
      return
    }

    res.setHeader('Content-Type', 'application/x-ndjson')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders?.()
    res.write('\n')

    const unsubscribe = subscribeProcessingProgress(id, event => writeProgressEvent(res, event))
    res.on('close', unsubscribe)
  }
}
