import { Request, Response } from 'express'
import multer from 'multer'
import path from 'path'
import { Database } from 'sqlite'
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

export function makeUploadHandler(db: Database) {
  return async function handleUpload(req: Request, res: Response): Promise<void> {
    if (!req.file) {
      res.status(400).json({ error: 'No file provided' })
      return
    }

    const { originalname, path: storedPath, mimetype } = req.file

    const result = await db.run(
      'INSERT INTO tax_documents (filename, stored_path, mime_type) VALUES (?, ?, ?)',
      [originalname, storedPath, mimetype]
    )

    const body: UploadResponse = { documentId: result.lastID! }
    res.status(201).json(body)
  }
}
