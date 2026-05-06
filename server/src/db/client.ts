import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'

const dbPath = process.env.DB_PATH ?? 'data/tax_ocr.db'

fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true })

const db = new Database(dbPath)
db.pragma('journal_mode = WAL')

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8')
db.exec(schema)

export default db
