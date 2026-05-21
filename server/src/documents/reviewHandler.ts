import fs from 'fs'
import { Request, Response } from 'express'
import { Database } from 'sqlite'
import { getAuthUser } from '../auth/authMiddleware'
import {
  decryptFields,
  decryptJsonPayload,
  encryptJsonPayload,
  encryptFields,
  isEncryptedJsonPayload,
} from './encryptionService'
import type { ExtractedFields, TaxReturnExtraction } from '../../../shared/types'

type TaxDocumentRow = {
  id: number
  status: string
  extracted_fields: string | null
  accepted_at: string | null
}

type AcceptedDocumentRow = {
  id: number
  filename: string
  extracted_fields: string
  accepted_at: string
}

const REQUIRED_FIELDS: (keyof ExtractedFields)[] = [
  'taxpayerName',
  'filingStatus',
  'totalWages',
  'totalTax',
  'refundOrOwed',
]

const FILING_STATUSES = new Set([
  'Single',
  'Married filing jointly',
  'Married filing separately',
  'Head of household',
  'Qualifying surviving spouse',
])

const MONEY_FIELDS: (keyof ExtractedFields)[] = ['totalWages', 'totalTax', 'refundOrOwed']
const MONEY_PATTERN = /^\$?\d{1,3}(,\d{3})*(\.\d{2})?$|^\$?\d+(\.\d{2})?$/
const MAX_FIELD_LENGTH = 80

type AcceptedFields = Record<keyof ExtractedFields, string>

function isTaxReturnExtraction(value: unknown): value is TaxReturnExtraction {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && (value as { schemaVersion?: unknown }).schemaVersion === 1
    && typeof (value as { forms?: unknown }).forms === 'object'
    && typeof (value as { summary?: unknown }).summary === 'object'
}

function legacyFieldsFromExtraction(extraction: TaxReturnExtraction): ExtractedFields {
  return {
    taxpayerName: extraction.summary.taxpayerName,
    filingStatus: extraction.summary.filingStatus,
    totalWages: extraction.summary.totalIncome,
    totalTax: extraction.summary.totalTax,
    refundOrOwed: extraction.summary.refundOrOwed,
  }
}

function decryptStoredExtraction(
  storedValue: string,
  username: string
): { fields: ExtractedFields; extraction: TaxReturnExtraction | null } {
  const parsed = JSON.parse(storedValue) as unknown
  if (isEncryptedJsonPayload(parsed)) {
    const extraction = decryptJsonPayload<TaxReturnExtraction>(parsed, username)
    return { fields: legacyFieldsFromExtraction(extraction), extraction }
  }

  return {
    fields: decryptFields(parsed as ExtractedFields, username),
    extraction: null,
  }
}

export function validateAcceptedFields(value: unknown): { fields: AcceptedFields } | { error: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { error: 'Fields must be an object' }
  }

  const input = value as Record<string, unknown>
  const fields = {} as AcceptedFields

  for (const key of REQUIRED_FIELDS) {
    const rawValue = input[key]

    if (typeof rawValue !== 'string') {
      return { error: `${key} is required` }
    }

    const trimmed = rawValue.trim()
    if (!trimmed) {
      return { error: `${key} is required` }
    }

    if (trimmed.length > MAX_FIELD_LENGTH) {
      return { error: `${key} is too long` }
    }

    fields[key] = trimmed
  }

  if (!FILING_STATUSES.has(fields.filingStatus)) {
    return { error: 'Filing status is invalid' }
  }

  for (const key of MONEY_FIELDS) {
    const value = fields[key]
    if (!value || !MONEY_PATTERN.test(value)) {
      return { error: `${key} must be a valid dollar amount` }
    }
  }

  return { fields }
}

export function makeReviewHandlers(db: Database) {
  const listAcceptedDocuments = async (req: Request, res: Response): Promise<void> => {
    const { username } = getAuthUser(req)
    const rows = await db.all<AcceptedDocumentRow[]>(
      `SELECT id, filename, extracted_fields, accepted_at
       FROM tax_documents
       WHERE owner_username = ? AND status = 'accepted'
       ORDER BY accepted_at DESC, id DESC`,
      [username]
    )

    res.json({
      records: rows.map(row => ({
        id: row.id,
        filename: row.filename,
        ...decryptStoredExtraction(row.extracted_fields, username),
        accepted_at: row.accepted_at,
      })),
    })
  }

  const getDocument = async (req: Request, res: Response): Promise<void> => {
    const { username } = getAuthUser(req)
    const id = parseInt(String(req.params.id), 10)
    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid document ID' })
      return
    }

    const row = await db.get<TaxDocumentRow>(
      'SELECT id, status, extracted_fields, accepted_at FROM tax_documents WHERE id = ? AND owner_username = ?',
      [id, username]
    )

    if (!row) {
      res.status(404).json({ error: 'Not found' })
      return
    }

    const decrypted = row.extracted_fields
      ? decryptStoredExtraction(row.extracted_fields, username)
      : { fields: null, extraction: null }

    res.json({
      id: row.id,
      status: row.status,
      fields: decrypted.fields,
      extraction: decrypted.extraction,
      accepted_at: row.accepted_at,
    })
  }

  const acceptDocument = async (req: Request, res: Response): Promise<void> => {
    const { username } = getAuthUser(req)
    const id = parseInt(String(req.params.id), 10)
    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid document ID' })
      return
    }

    const body = req.body as { fields?: unknown; extraction?: unknown }
    const extraction = isTaxReturnExtraction(body.extraction) ? body.extraction : null
    const validation = extraction ? null : validateAcceptedFields(body.fields)
    if (validation && 'error' in validation) {
      res.status(400).json({ error: validation.error })
      return
    }

    const row = await db.get<{ status: string }>(
      'SELECT status FROM tax_documents WHERE id = ? AND owner_username = ?',
      [id, username]
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
       WHERE id = ? AND owner_username = ?`,
      JSON.stringify(extraction
        ? encryptJsonPayload(extraction, username)
        : encryptFields(validation!.fields, username)
      ),
      id,
      username
    )

    const updated = await db.get<{ accepted_at: string }>(
      'SELECT accepted_at FROM tax_documents WHERE id = ? AND owner_username = ?',
      [id, username]
    )

    res.json({ accepted_at: updated!.accepted_at })
  }

  const getDocumentFile = async (req: Request, res: Response): Promise<void> => {
    const { username } = getAuthUser(req)
    const id = parseInt(String(req.params.id), 10)
    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid document ID' })
      return
    }

    const row = await db.get<{ stored_path: string; mime_type: string }>(
      'SELECT stored_path, mime_type FROM tax_documents WHERE id = ? AND owner_username = ?',
      [id, username]
    )

    if (!row) {
      res.status(404).json({ error: 'Not found' })
      return
    }

    if (!fs.existsSync(row.stored_path)) {
      res.status(404).json({ error: 'File not found' })
      return
    }

    res.setHeader('Content-Type', row.mime_type)
    res.setHeader('Content-Disposition', 'inline')
    fs.createReadStream(row.stored_path).pipe(res)
  }

  return { listAcceptedDocuments, getDocument, acceptDocument, getDocumentFile }
}
