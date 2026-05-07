import { Request, Response } from 'express'
import { Database } from 'sqlite'
import { getAuthUser } from '../auth/authMiddleware'
import { runOcr } from './ocrService'
import { extractFields, getDemoFields } from './extractionService'
import { encryptFields, decryptFields } from './encryptionService'
import type { ExtractedFields, DocumentStatus } from '../../../shared/types'

type TaxDocument = { id: number; stored_path: string; status: string }

export function makeProcessHandler(db: Database) {
  return async function handleProcess(req: Request, res: Response): Promise<void> {
    const { username } = getAuthUser(req)
    const id = parseInt(String(req.params.id), 10)
    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid document ID' })
      return
    }

    const doc = await db.get<TaxDocument>(
      'SELECT id, stored_path, status FROM tax_documents WHERE id = ? AND owner_username = ?',
      [id, username]
    )

    if (!doc) {
      res.status(404).json({ error: 'Not found' })
      return
    }

    if (doc.status !== 'pending') {
      res.status(409).json({ error: 'Already processed' })
      return
    }

    const claim = await db.run(
      'UPDATE tax_documents SET status = ? WHERE id = ? AND owner_username = ? AND status = ?',
      ['processing', id, username, 'pending']
    )

    if (claim.changes !== 1) {
      res.status(409).json({ error: 'Already processing or processed' })
      return
    }

    let fields: ExtractedFields
    let status: DocumentStatus = 'extracted'

    if (process.env.DEMO_MODE === 'true') {
      fields = getDemoFields()
    } else {
      try {
        const text = await runOcr(doc.stored_path)
        fields = extractFields(text)
      } catch {
        fields = { taxpayerName: null, filingStatus: null, totalWages: null, totalTax: null, refundOrOwed: null }
        status = 'failed'
      }
    }

    const encrypted = encryptFields(fields)

    await db.run(
      'UPDATE tax_documents SET extracted_fields = ?, status = ?, processed_at = ? WHERE id = ? AND owner_username = ?',
      [JSON.stringify(encrypted), status, new Date().toISOString(), id, username]
    )

    res.json({ documentId: id, status, fields: decryptFields(encrypted) })
  }
}
