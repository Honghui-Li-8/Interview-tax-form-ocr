import { useState, useRef } from 'react'
import { uploadDocument } from '../api/documents'

const MAX_FILE_SIZE = 10 * 1024 * 1024

type UploadState = 'idle' | 'uploading' | 'success' | 'error'

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null)
  const [idempotencyKey, setIdempotencyKey] = useState<string>(crypto.randomUUID())
  const [replace, setReplace] = useState(false)
  const [state, setState] = useState<UploadState>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [documentId, setDocumentId] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0] ?? null

    if (selected && selected.size > MAX_FILE_SIZE) {
      setFile(null)
      setState('error')
      setMessage('File must be under 10 MB')
      return
    }

    setFile(selected)
    setIdempotencyKey(crypto.randomUUID())
    setState('idle')
    setMessage(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!file) return

    setState('uploading')
    setMessage(null)

    try {
      const { documentId: id, replaced } = await uploadDocument(file, idempotencyKey, replace)
      setDocumentId(id)
      setState('success')
      setMessage(replaced ? 'File replaced successfully.' : null)
    } catch (err) {
      setState('error')
      setMessage(err instanceof Error ? err.message : 'Upload failed, please try again')
    }
  }

  function handleReset() {
    setFile(null)
    setIdempotencyKey(crypto.randomUUID())
    setReplace(false)
    setState('idle')
    setMessage(null)
    setDocumentId(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif', maxWidth: '480px' }}>
      <h1>Tax Form OCR</h1>
      <p>Upload your 1040 PDF to extract and review your tax data.</p>

      {state === 'success' ? (
        <div>
          <p style={{ color: 'green' }}>
            Upload successful — Document ID: {documentId}
            {message && ` (${message})`}
          </p>
          <button onClick={handleReset}>Upload another</button>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '1rem' }}>
            <input
              ref={inputRef}
              type="file"
              accept=".pdf"
              onChange={handleFileChange}
              disabled={state === 'uploading'}
            />
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label>
              <input
                type="checkbox"
                checked={replace}
                onChange={(e) => setReplace(e.target.checked)}
                disabled={state === 'uploading'}
              />
              {' '}Replace existing upload with this key
            </label>
          </div>

          {message && (
            <p style={{ color: 'red', marginBottom: '1rem' }}>{message}</p>
          )}

          <button type="submit" disabled={!file || state === 'uploading'}>
            {state === 'uploading' ? 'Uploading...' : 'Upload'}
          </button>
        </form>
      )}
    </div>
  )
}
