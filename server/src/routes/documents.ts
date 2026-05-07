import { Router } from 'express'
import { Database } from 'sqlite'
import { upload, makeUploadHandler } from '../documents/uploadHandler'
import { makeProcessHandler } from '../documents/processHandler'

export function makeDocumentsRouter(db: Database): Router {
  const router = Router()
  const handleUpload = makeUploadHandler(db)
  const handleProcess = makeProcessHandler(db)

  router.post('/upload', (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (err instanceof Error) {
        res.status(400).json({ error: err.message })
        return
      }
      next()
    })
  }, handleUpload)

  router.post('/:id/process', handleProcess)

  return router
}
