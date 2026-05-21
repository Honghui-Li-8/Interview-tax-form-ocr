/**
 * Field-level encryption for extracted tax document data.
 *
 * Algorithm: AES-256-GCM
 *
 * Key derivation (2-layer):
 *   compositeKey = SHA-256( MASTER_ENCRYPTION_KEY + ":" + username )
 *
 *   Layer 1  MASTER_ENCRYPTION_KEY — server-side secret (env var, 32-byte hex).
 *   Layer 2  username              — stand-in for a user secret; in production
 *                                    this would be the user's password or a key
 *                                    derived from it, so neither layer alone is
 *                                    enough to decrypt the data.
 *
 * Per-field storage format:
 *   base64( iv[12 bytes] | authTag[16 bytes] | ciphertext )
 *
 *   A fresh random IV per encrypt call means identical plaintexts produce
 *   different ciphertexts. The GCM auth tag detects tampering on decrypt.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'
import type { ExtractedFields } from '../../../shared/types'

const isDevObservabilityEnabled = (): boolean =>
  process.env.NODE_ENV !== 'production' && process.env.DEBUG === 'true'

function logEncryption(message: string): void {
  if (isDevObservabilityEnabled()) {
    console.log(`[encryption] ${message}`)
  }
}

function deriveFieldKey(username: string): Buffer {
  const master = process.env.MASTER_ENCRYPTION_KEY
  if (!master) throw new Error('MASTER_ENCRYPTION_KEY is required')
  return createHash('sha256').update(`${master}:${username}`).digest()
}

function encryptValue(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted]).toString('base64')
}

function decryptValue(ciphertext: string, key: Buffer): string {
  const buf = Buffer.from(ciphertext, 'base64')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const data = buf.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}

export function encryptFields(fields: ExtractedFields, username: string): ExtractedFields {
  const key = deriveFieldKey(username)
  const result = {} as ExtractedFields
  const fieldNames: string[] = []
  for (const [k, v] of Object.entries(fields)) {
    (result as Record<string, unknown>)[k] = v !== null ? encryptValue(v, key) : null
    if (v !== null) fieldNames.push(k)
  }
  logEncryption(`encrypted ${fieldNames.length} fields: ${fieldNames.join(', ')}`)
  return result
}

export function decryptFields(fields: ExtractedFields, username: string): ExtractedFields {
  const key = deriveFieldKey(username)
  const result = {} as ExtractedFields
  const fieldNames: string[] = []
  for (const [k, v] of Object.entries(fields)) {
    (result as Record<string, unknown>)[k] = v !== null ? decryptValue(v as string, key) : null
    if (v !== null) fieldNames.push(k)
  }
  logEncryption(`decrypted ${fieldNames.length} fields: ${fieldNames.join(', ')}`)
  return result
}

export type EncryptedJsonPayload = {
  __encryptedJson: string
}

export function encryptJsonPayload<T>(payload: T, username: string): EncryptedJsonPayload {
  const key = deriveFieldKey(username)
  logEncryption('encrypted JSON payload')
  return { __encryptedJson: encryptValue(JSON.stringify(payload), key) }
}

export function decryptJsonPayload<T>(payload: EncryptedJsonPayload, username: string): T {
  const key = deriveFieldKey(username)
  logEncryption('decrypted JSON payload')
  return JSON.parse(decryptValue(payload.__encryptedJson, key)) as T
}

export function isEncryptedJsonPayload(value: unknown): value is EncryptedJsonPayload {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof (value as Record<string, unknown>).__encryptedJson === 'string'
}
