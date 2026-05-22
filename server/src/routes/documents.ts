import { Router } from 'express'
import { Database } from 'sqlite'
import { upload, makeUploadHandler } from '../documents/uploadHandler'
import { makeProcessHandler } from '../documents/processHandler'
import { makeReviewHandlers } from '../documents/reviewHandler'
import { makeProcessingProgressHandler } from '../documents/processingProgressHandler'

export function makeDocumentsRouter(db: Database): Router {
  const router = Router()
  const handleUpload = makeUploadHandler(db)
  const handleProcess = makeProcessHandler(db)
  const handleProcessingProgress = makeProcessingProgressHandler(db)
  const { listAcceptedDocuments, getDocument, acceptDocument, getDocumentFile } = makeReviewHandlers(db)

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
  router.get('/:id/process/progress', handleProcessingProgress)
  router.get('/accepted', listAcceptedDocuments)
  router.get('/:id/file', getDocumentFile)
  router.get('/:id', getDocument)
  router.patch('/:id/accept', acceptDocument)

  return router
}
