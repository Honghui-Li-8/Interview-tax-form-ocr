import { useState, useRef } from 'react'
import { uploadDocument } from '../api/documents'
import { isUnauthorizedError } from '../api/auth'

const MAX_FILE_SIZE = 10 * 1024 * 1024

type UploadState = 'idle' | 'uploading' | 'success' | 'error'

type Props = {
  onReview: (documentId: number) => void
  onUnauthorized: () => void
}

export default function UploadPage({ onReview, onUnauthorized }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [idempotencyKey, setIdempotencyKey] = useState<string>(crypto.randomUUID())
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
      const { documentId: id, replaced } = await uploadDocument(file, idempotencyKey, false)
      setDocumentId(id)
      setState('success')
      setMessage(replaced ? 'File replaced successfully.' : null)
    } catch (err) {
      if (isUnauthorizedError(err)) {
        onUnauthorized()
        return
      }

      setState('error')
      setMessage(err instanceof Error ? err.message : 'Upload failed, please try again')
    }
  }

  function handleReset() {
    setFile(null)
    setIdempotencyKey(crypto.randomUUID())
    setState('idle')
    setMessage(null)
    setDocumentId(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <section className="page-grid">
      <div className="page-intro">
        <p className="eyebrow">Upload</p>
        <h1>Start a tax form review</h1>
        <p className="page-subtitle">
          Upload a 1040 PDF to extract key tax fields and confirm them before
          saving.
        </p>
      </div>

      {state === "success" ? (
        <div className="panel success-panel">
          <div className="status-icon">✓</div>
          <h2>Upload successful</h2>
          <p className="muted">
            Document ID: {documentId}
            {message && ` (${message})`}
          </p>
          <div className="button-row">
            <button
              className="button button-primary"
              onClick={() => onReview(documentId!)}
            >
              Review Document
            </button>
            <button className="button button-secondary" onClick={handleReset}>
              Upload another
            </button>
          </div>
        </div>
      ) : (
        <form className="panel upload-panel" onSubmit={handleSubmit}>
          <label className={`file-drop ${file ? "has-file" : ""}`}>
            <span className="file-icon">PDF</span>
            <span className="file-title">
              {file ? file.name : "Choose a 1040 PDF"}
            </span>
            <span className="file-meta">
              {file
                ? `${(file.size / 1024 / 1024).toFixed(2)} MB`
                : "PDF only, up to 10 MB"}
            </span>
            <input
              ref={inputRef}
              type="file"
              accept=".pdf"
              onChange={handleFileChange}
              disabled={state === "uploading"}
            />
          </label>

          <details className="upload-details">
            <summary>
              <span>Upload session</span>
              <strong>{idempotencyKey.slice(0, 8)}</strong>
            </summary>
            <p>
              Idempotency key: prevents duplicate records when an upload is retried.
            </p>
            <code>{idempotencyKey}</code>
          </details>

          {message && <p className="alert alert-error">{message}</p>}

          <button
            className="button button-primary button-wide"
            type="submit"
            disabled={!file || state === "uploading"}
          >
            {state === "uploading" ? "Uploading..." : "Upload"}
          </button>
        </form>
      )}
    </section>
  );
}
