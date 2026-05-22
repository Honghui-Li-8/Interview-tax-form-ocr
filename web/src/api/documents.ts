import type {
  UploadResponse,
  ProcessResponse,
  DocumentDetail,
  AcceptResponse,
  ExtractedFields,
  AcceptedDocumentsResponse,
  TaxReturnExtraction,
  ProcessingProgressEvent,
} from '../../../shared/types'
import { getToken, UnauthorizedError } from './auth'

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001'

function authHeaders(): Record<string, string> {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function fallbackErrorMessage(res: Response): string {
  if (res.status === 504) {
    return 'Processing took longer than the server allowed. Refresh the status or try again.'
  }
  return `Request failed with status ${res.status}.`
}

async function responseErrorMessage(res: Response): Promise<string> {
  const text = await res.text()
  if (!text.trim()) return fallbackErrorMessage(res)

  try {
    const parsed = JSON.parse(text) as { error?: unknown }
    if (typeof parsed.error === 'string') return parsed.error
  } catch {
    // Non-JSON errors can be proxy HTML pages; keep those out of the UI.
  }

  if (/<\/?[a-z][\s\S]*>/i.test(text)) {
    return fallbackErrorMessage(res)
  }

  return text
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (res.status === 401) throw new UnauthorizedError()
  if (!res.ok) {
    throw new Error(await responseErrorMessage(res))
  }
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

export async function listAcceptedDocuments(): Promise<AcceptedDocumentsResponse> {
  return handleResponse(await fetch(`${SERVER_URL}/api/documents/accepted`, {
    headers: authHeaders(),
  }))
}

export async function getDocumentFile(id: number): Promise<string> {
  const res = await fetch(`${SERVER_URL}/api/documents/${id}/file`, {
    headers: authHeaders(),
  })
  if (res.status === 401) throw new UnauthorizedError()
  if (!res.ok) throw new Error(await responseErrorMessage(res))
  return URL.createObjectURL(await res.blob())
}

export async function acceptDocument(
  id: number,
  payload: ExtractedFields | TaxReturnExtraction
): Promise<AcceptResponse> {
  const body = 'schemaVersion' in payload
    ? { extraction: payload }
    : { fields: payload }

  return handleResponse(await fetch(`${SERVER_URL}/api/documents/${id}/accept`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  }))
}

export function parseProcessingProgressLines(
  chunk: string,
  carry: string,
  onEvent: (event: ProcessingProgressEvent) => void
): string {
  const lines = `${carry}${chunk}`.split('\n')
  const nextCarry = lines.pop() ?? ''

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      onEvent(JSON.parse(trimmed) as ProcessingProgressEvent)
    } catch (err) {
      if (import.meta.env.DEV) {
        console.debug('Ignoring malformed processing progress event', err)
      }
    }
  }

  return nextCarry
}

export async function streamProcessingProgress(
  documentId: number,
  onEvent: (event: ProcessingProgressEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(`${SERVER_URL}/api/documents/${documentId}/process/progress`, {
    headers: authHeaders(),
    signal,
  })

  if (res.status === 401) throw new UnauthorizedError()
  if (!res.ok) throw new Error(await res.text())
  if (!res.body) throw new Error('Progress stream is not available')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let carry = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    carry = parseProcessingProgressLines(decoder.decode(value, { stream: true }), carry, onEvent)
  }

  const finalChunk = decoder.decode()
  carry = parseProcessingProgressLines(finalChunk, carry, onEvent)
  if (carry.trim() && import.meta.env.DEV) {
    console.debug('Ignoring incomplete processing progress line')
  }
}
