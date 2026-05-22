import { Request, Response } from 'express'
import { Database } from 'sqlite'
import { getAuthUser } from '../auth/authMiddleware'
import { decryptJsonPayload, encryptJsonPayload } from './encryptionService'
import { parseTaxReturnPacket } from './claudeTaxParserService'
import { mergeParsedForms } from './taxPacketMergeService'
import type { ExtractedFields, DocumentStatus, TaxReturnExtraction } from '../../../shared/types'
import { emitProcessingProgress } from './processingProgressService'

type TaxDocument = { id: number; stored_path: string; status: DocumentStatus }
type ProcessJobResult = {
  status: DocumentStatus
  extraction: TaxReturnExtraction
  fields: ExtractedFields
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

function demoExtraction(): TaxReturnExtraction {
  const fields: ExtractedFields = {
    taxpayerName: 'Billie J. Does',
    filingStatus: 'Single',
    totalWages: '39,027',
    totalTax: '2,978',
    refundOrOwed: '147',
  }
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

async function runDocumentProcessingJob(
  db: Database,
  id: number,
  username: string,
  storedPath: string
): Promise<ProcessJobResult> {
  let extraction: TaxReturnExtraction
  let status: DocumentStatus = 'extracted'

  try {
    if (process.env.DEMO_MODE === 'true') {
      extraction = demoExtraction()
    } else {
      extraction = await parseTaxReturnPacket(storedPath, {
        onProgress: event => emitProcessingProgress(id, event),
      })
    }
  } catch {
    extraction = failedExtraction('Document parsing failed. Review the uploaded PDF and parser configuration.')
    status = 'failed'
  }

  try {
    emitProcessingProgress(id, {
      phase: 'encrypting_and_persisting',
      message: 'Saving extraction',
      percent: status === 'extracted' ? 95 : null,
      warningCodes: extraction.warnings.map(warning => warning.code),
    })

    const encrypted = encryptJsonPayload(extraction, username)

    await db.run(
      'UPDATE tax_documents SET extracted_fields = ?, status = ?, processed_at = ? WHERE id = ? AND owner_username = ?',
      [JSON.stringify(encrypted), status, new Date().toISOString(), id, username]
    )

    if (status === 'extracted') {
      emitProcessingProgress(id, {
        phase: 'completed',
        message: 'Document processing completed',
        percent: 100,
        warningCodes: extraction.warnings.map(warning => warning.code),
      })
    } else {
      emitProcessingProgress(id, {
        phase: 'failed',
        message: 'Document parsing failed',
        percent: null,
        warningCodes: extraction.warnings.map(warning => warning.code),
      })
    }

    const decryptedExtraction = decryptJsonPayload<TaxReturnExtraction>(encrypted, username)
    return {
      status,
      extraction: decryptedExtraction,
      fields: legacyFieldsFromExtraction(decryptedExtraction),
    }
  } catch {
    const failed = failedExtraction('Document processing failed while saving extraction results.')
    const encrypted = encryptJsonPayload(failed, username)

    await db.run(
      'UPDATE tax_documents SET extracted_fields = ?, status = ?, processed_at = ? WHERE id = ? AND owner_username = ?',
      [JSON.stringify(encrypted), 'failed', new Date().toISOString(), id, username]
    )

    emitProcessingProgress(id, {
      phase: 'failed',
      message: 'Document processing failed',
      percent: null,
      warningCodes: failed.warnings.map(warning => warning.code),
    })

    return {
      status: 'failed',
      extraction: failed,
      fields: legacyFieldsFromExtraction(failed),
    }
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

    if (doc.status === 'processing') {
      res.status(202).json({ documentId: id, status: doc.status })
      return
    }

    if (doc.status !== 'pending') {
      res.json({ documentId: id, status: doc.status })
      return
    }

    emitProcessingProgress(id, {
      phase: 'claiming',
      message: 'Claiming document for processing',
      percent: 5,
    })

    const claim = await db.run(
      'UPDATE tax_documents SET status = ? WHERE id = ? AND owner_username = ? AND status = ?',
      ['processing', id, username, 'pending']
    )

    if (claim.changes !== 1) {
      const latestDoc = await db.get<TaxDocument>(
        'SELECT id, stored_path, status FROM tax_documents WHERE id = ? AND owner_username = ?',
        [id, username]
      )
      const status = latestDoc?.status ?? 'processing'
      res.status(status === 'processing' ? 202 : 200).json({ documentId: id, status })
      return
    }

    void runDocumentProcessingJob(db, id, username, doc.stored_path).catch(() => {
      emitProcessingProgress(id, {
        phase: 'failed',
        message: 'Document processing failed',
        percent: null,
        warningCodes: ['PARSER_FAILED'],
      })
    })
    res.status(202).json({ documentId: id, status: 'processing' })
  }
}
