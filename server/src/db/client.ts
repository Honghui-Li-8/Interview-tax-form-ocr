import { open, Database } from 'sqlite'
import sqlite3 from 'sqlite3'
import fs from 'fs'
import path from 'path'

const dbPath = process.env.DB_PATH ?? 'data/tax_ocr.db'

export async function initDb(): Promise<Database> {
  fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true })

  const db = await open({ filename: dbPath, driver: sqlite3.Database })
  db.configure('busyTimeout', 5000)

  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8')
  await db.exec(schema)

  return db
}
