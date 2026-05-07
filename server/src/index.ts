import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import fs from 'fs'
import { Database } from 'sqlite'
import { initDb } from './db/client'
import { makeDocumentsRouter } from './routes/documents'

dotenv.config()

async function main() {
  const db: Database = await initDb()

  fs.mkdirSync('uploads', { recursive: true })

  const app = express()
  const port = process.env.PORT ?? 3001

  app.use(cors())
  app.use(express.json())

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

  app.use('/api/documents', makeDocumentsRouter(db))

  app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`)
  })
}

main().catch((err) => {
  console.error('Failed to start server:', err)
  process.exit(1)
})
