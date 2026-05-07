import type {
  UploadResponse,
  ProcessResponse,
  DocumentDetail,
  AcceptResponse,
  ExtractedFields,
  AcceptedDocumentRecord,
} from '../../../shared/types'
import { getToken, UnauthorizedError } from './auth'

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001'

function authHeaders(): Record<string, string> {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (res.status === 401) throw new UnauthorizedError()
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
    headers: authHeaders(),
    body: form,
  }))
}

export async function processDocument(id: number): Promise<ProcessResponse> {
  return handleResponse(await fetch(`${SERVER_URL}/api/documents/${id}/process`, {
    method: 'POST',
    headers: authHeaders(),
  }))
}

export async function getDocument(id: number): Promise<DocumentDetail> {
  return handleResponse(await fetch(`${SERVER_URL}/api/documents/${id}`, {
    headers: authHeaders(),
  }))
}

export async function listAcceptedDocuments(): Promise<{ records: AcceptedDocumentRecord[] }> {
  return handleResponse(await fetch(`${SERVER_URL}/api/documents/accepted`, {
    headers: authHeaders(),
  }))
}

export async function acceptDocument(id: number, fields: ExtractedFields): Promise<AcceptResponse> {
  return handleResponse(await fetch(`${SERVER_URL}/api/documents/${id}/accept`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ fields }),
  }))
}
