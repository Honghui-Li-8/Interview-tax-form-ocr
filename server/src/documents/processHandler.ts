import { Request, Response } from 'express'
import { Database } from 'sqlite'
import { getAuthUser } from '../auth/authMiddleware'
import { getDemoFields } from './extractionService'
import { decryptJsonPayload, encryptJsonPayload } from './encryptionService'
import { parseTaxReturnPacket } from './claudeTaxParserService'
import { mergeParsedForms } from './taxPacketMergeService'
import type { ExtractedFields, DocumentStatus, TaxReturnExtraction } from '../../../shared/types'

type TaxDocument = { id: number; stored_path: string; status: string }

function legacyFieldsFromExtraction(extraction: TaxReturnExtraction): ExtractedFields {
  return {
    taxpayerName: extraction.summary.taxpayerName,
    filingStatus: extraction.summary.filingStatus,
    totalWages: extraction.summary.totalIncome,
    totalTax: extraction.summary.totalTax,
    refundOrOwed: extraction.summary.refundOrOwed,
  }
}

function demoExtraction(): TaxReturnExtraction {
  const fields = getDemoFields()
  return {
    ...mergeParsedForms([], {}),
    summary: {
      taxpayerName: fields.taxpayerName,
      filingStatus: fields.filingStatus,
      totalIncome: fields.totalWages,
      totalTax: fields.totalTax,
      refundOrOwed: fields.refundOrOwed,
    },
  }
}

function failedExtraction(message: string): TaxReturnExtraction {
  const extraction = mergeParsedForms([], {})
  return {
    ...extraction,
    warnings: [
      ...extraction.warnings,
      {
        severity: 'error',
        code: 'PARSER_FAILED',
        message,
        fields: [],
        pages: [],
      },
    ],
  }
}

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

    let extraction: TaxReturnExtraction
    let status: DocumentStatus = 'extracted'

    if (process.env.DEMO_MODE === 'true') {
      extraction = demoExtraction()
    } else {
      try {
        extraction = await parseTaxReturnPacket(doc.stored_path)
      } catch {
        extraction = failedExtraction('Document parsing failed. Review the uploaded PDF and parser configuration.')
        status = 'failed'
      }
    }

    const encrypted = encryptJsonPayload(extraction, username)

    await db.run(
      'UPDATE tax_documents SET extracted_fields = ?, status = ?, processed_at = ? WHERE id = ? AND owner_username = ?',
      [JSON.stringify(encrypted), status, new Date().toISOString(), id, username]
    )

    const decryptedExtraction = decryptJsonPayload<TaxReturnExtraction>(encrypted, username)
    res.json({
      documentId: id,
      status,
      extraction: decryptedExtraction,
      fields: legacyFieldsFromExtraction(decryptedExtraction),
    })
  }
}
