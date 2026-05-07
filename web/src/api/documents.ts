import type { UploadResponse, ProcessResponse, DocumentDetail, AcceptResponse, ExtractedFields } from '../../../shared/types'

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001'

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function uploadDocument(
  file: File,
  idempotencyKey: string,
  replace: boolean
): Promise<UploadResponse> {
  const form = new FormData()
  form.append('file', file)
  form.append('idempotencyKey', idempotencyKey)
  form.append('replace', String(replace))

  return handleResponse(await fetch(`${SERVER_URL}/api/documents/upload`, {
    method: 'POST',
    body: form,
  }))
}

export async function processDocument(id: number): Promise<ProcessResponse> {
  return handleResponse(await fetch(`${SERVER_URL}/api/documents/${id}/process`, {
    method: 'POST',
  }))
}

export async function getDocument(id: number): Promise<DocumentDetail> {
  return handleResponse(await fetch(`${SERVER_URL}/api/documents/${id}`))
}

export async function acceptDocument(id: number, fields: ExtractedFields): Promise<AcceptResponse> {
  return handleResponse(await fetch(`${SERVER_URL}/api/documents/${id}/accept`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  }))
}
