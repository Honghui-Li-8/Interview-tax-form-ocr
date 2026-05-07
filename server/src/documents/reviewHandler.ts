import { Request, Response } from 'express'
import { Database } from 'sqlite'
import { decryptFields, encryptFields } from './encryptionService'
import type { ExtractedFields } from '../../../shared/types'

type TaxDocumentRow = {
  id: number
  status: string
  extracted_fields: string | null
  accepted_at: string | null
}

const REQUIRED_FIELDS: (keyof ExtractedFields)[] = [
  'taxpayerName',
  'filingStatus',
  'totalWages',
  'totalTax',
  'refundOrOwed',
]

export function makeReviewHandlers(db: Database) {
  const getDocument = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(String(req.params.id), 10)
    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid document ID' })
      return
    }

    const row = await db.get<TaxDocumentRow>(
      'SELECT id, status, extracted_fields, accepted_at FROM tax_documents WHERE id = ?',
      id
    )

    if (!row) {
      res.status(404).json({ error: 'Not found' })
      return
    }

    const fields: ExtractedFields | null = row.extracted_fields
      ? decryptFields(JSON.parse(row.extracted_fields))
      : null

    res.json({ id: row.id, status: row.status, fields, accepted_at: row.accepted_at })
  }

  const acceptDocument = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(String(req.params.id), 10)
    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid document ID' })
      return
    }

    const { fields } = req.body as { fields: ExtractedFields }
    if (!fields || REQUIRED_FIELDS.some(k => !fields[k]?.trim())) {
      res.status(400).json({ error: 'All five fields are required and must be non-empty' })
      return
    }

    const row = await db.get<{ status: string }>(
      'SELECT status FROM tax_documents WHERE id = ?',
      id
    )

    if (!row) {
      res.status(404).json({ error: 'Not found' })
      return
    }

    if (row.status === 'accepted') {
      res.status(409).json({ error: 'Already accepted' })
      return
    }

    await db.run(
      `UPDATE tax_documents
       SET extracted_fields = ?, status = 'accepted', accepted_at = datetime('now')
       WHERE id = ?`,
      JSON.stringify(encryptFields(fields)),
      id
    )

    const updated = await db.get<{ accepted_at: string }>(
      'SELECT accepted_at FROM tax_documents WHERE id = ?',
      id
    )

    res.json({ accepted_at: updated!.accepted_at })
  }

  return { getDocument, acceptDocument }
}
