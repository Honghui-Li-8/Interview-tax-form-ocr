import { open, Database } from 'sqlite'
import sqlite3 from 'sqlite3'
import fs from 'fs'
import path from 'path'

const dbPath = process.env.DB_PATH ?? 'data/tax_ocr.db'

function getDefaultOwnerUsername(): string {
  const firstUser = process.env.AUTH_USERS?.split(',')[0]?.split(':')[0]?.trim()
  return firstUser || 'user'
}

export async function initDb(): Promise<Database> {
  fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true })

  const db = await open({ filename: dbPath, driver: sqlite3.Database })
  db.configure('busyTimeout', 5000)

  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8')
  await db.exec(schema)

  const columns = await db.all<{ name: string }[]>('PRAGMA table_info(tax_documents)')
  const hasOwnerUsername = columns.some((column) => column.name === 'owner_username')

  // Exercise-scoped migration: preserve local demo DBs when ownership was added.
  // A production app will use versioned migrations instead of startup DDL.
  if (!hasOwnerUsername) {
    const defaultOwner = getDefaultOwnerUsername().replace(/'/g, "''")
    await db.exec(`ALTER TABLE tax_documents ADD COLUMN owner_username TEXT NOT NULL DEFAULT '${defaultOwner}'`)
  }

  await db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tax_documents_owner_idempotency_key
    ON tax_documents(owner_username, idempotency_key)
  `)

  return db
}
