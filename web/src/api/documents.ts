import type { UploadResponse } from '../../../shared/types'

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001'

export async function uploadDocument(
  file: File,
  idempotencyKey: string,
  replace: boolean
): Promise<UploadResponse> {
  const form = new FormData()
  form.append('file', file)
  form.append('idempotencyKey', idempotencyKey)
  form.append('replace', String(replace))

  const res = await fetch(`${SERVER_URL}/api/documents/upload`, {
    method: 'POST',
    body: form,
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(text)
  }

  return res.json()
}
