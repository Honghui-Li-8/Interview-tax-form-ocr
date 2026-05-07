import { Router } from 'express'
import { Database } from 'sqlite'
import { upload, makeUploadHandler } from '../documents/uploadHandler'

export function makeDocumentsRouter(db: Database): Router {
  const router = Router()
  const handleUpload = makeUploadHandler(db)

  router.post('/upload', (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (err instanceof Error) {
        res.status(400).json({ error: err.message })
        return
      }
      next()
    })
  }, handleUpload)

  return router
}
