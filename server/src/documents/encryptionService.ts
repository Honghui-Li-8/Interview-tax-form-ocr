import type { ExtractedFields } from '../../../shared/types'

// TODO: replace with AES-256-GCM field encryption before production use
export function encryptFields(fields: ExtractedFields): ExtractedFields {
  return fields
}

// TODO: decrypt fields after DB read before returning to client
export function decryptFields(fields: ExtractedFields): ExtractedFields {
  return fields
}
