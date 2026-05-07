import { Request, Response } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { Database } from 'sqlite'
import { getAuthUser } from '../auth/authMiddleware'
import type { UploadResponse } from '../../../shared/types'

const ALLOWED_MIME_TYPES = new Set(['application/pdf'])

export const upload = multer({
  storage: multer.diskStorage({
    destination: 'uploads/',
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname)
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`)
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('Only PDF files are accepted'))
    }
  },
})

type ExistingDocument = { id: number; stored_path: string }

export function makeUploadHandler(db: Database) {
  return async function handleUpload(req: Request, res: Response): Promise<void> {
    const { username } = getAuthUser(req)

    if (!req.file) {
      res.status(400).json({ error: 'No file provided' })
      return
    }

    const { originalname, path: storedPath, mimetype } = req.file
    const idempotencyKey = typeof req.body.idempotencyKey === 'string'
      ? req.body.idempotencyKey
      : null
    const replace = req.body.replace === 'true'

    if (idempotencyKey) {
      const existing = await db.get<ExistingDocument>(
        'SELECT id, stored_path FROM tax_documents WHERE idempotency_key = ? AND owner_username = ?',
        [idempotencyKey, username]
      )

      if (existing) {
        if (!replace) {
          fs.unlinkSync(storedPath)
          const body: UploadResponse = { documentId: existing.id, replaced: false }
          res.status(200).json(body)
          return
        }

        fs.rmSync(existing.stored_path, { force: true })
        await db.run(
          `UPDATE tax_documents
           SET filename = ?, stored_path = ?, mime_type = ?, status = ?, extracted_fields = NULL,
               processed_at = NULL, accepted_at = NULL, created_at = datetime('now')
           WHERE id = ? AND owner_username = ?`,
          [originalname, storedPath, mimetype, 'pending', existing.id, username]
        )
        const body: UploadResponse = { documentId: existing.id, replaced: true }
        res.status(200).json(body)
        return
      }
    }

    const result = await db.run(
      'INSERT INTO tax_documents (idempotency_key, owner_username, filename, stored_path, mime_type) VALUES (?, ?, ?, ?, ?)',
      [idempotencyKey, username, originalname, storedPath, mimetype]
    )

    const body: UploadResponse = { documentId: result.lastID!, replaced: false }
    res.status(201).json(body)
  }
}
