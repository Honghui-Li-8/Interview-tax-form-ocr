import { Request, Response } from 'express'
import { Database } from 'sqlite'
import { runOcr } from './ocrService'
import { extractFields, getDemoFields } from './extractionService'
import { encryptFields, decryptFields } from './encryptionService'
import type { ExtractedFields, DocumentStatus } from '../../../shared/types'

type TaxDocument = { id: number; stored_path: string; status: string }

export function makeProcessHandler(db: Database) {
  return async function handleProcess(req: Request, res: Response): Promise<void> {
    const id = parseInt(String(req.params.id), 10)
    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid document ID' })
      return
    }

    const doc = await db.get<TaxDocument>(
      'SELECT id, stored_path, status FROM tax_documents WHERE id = ?',
      id
    )

    if (!doc) {
      res.status(404).json({ error: 'Not found' })
      return
    }

    if (doc.status !== 'pending') {
      res.status(409).json({ error: 'Already processed' })
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
      'UPDATE tax_documents SET extracted_fields = ?, status = ?, processed_at = ? WHERE id = ?',
      [JSON.stringify(encrypted), status, new Date().toISOString(), id]
    )

    res.json({ documentId: id, status, fields: decryptFields(encrypted) })
  }
}
