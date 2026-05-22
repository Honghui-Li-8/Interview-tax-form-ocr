import { useCallback, useEffect, useState } from 'react'
import { listAcceptedDocuments } from '../api/documents'
import { isUnauthorizedError } from '../api/auth'
import type { AcceptedDocumentRecord, ExtractedFields } from '../../../shared/types'

type SavedRecordsState = 'loading' | 'ready' | 'error'

const FIELD_LABELS: { key: keyof ExtractedFields; label: string }[] = [
  { key: 'taxpayerName',  label: 'Taxpayer Name' },
  { key: 'filingStatus',  label: 'Filing Status' },
  { key: 'totalWages',    label: 'Total Wages / Income' },
  { key: 'totalTax',      label: 'Total Tax' },
  { key: 'refundOrOwed',  label: 'Refund or Amount Owed' },
]

type Props = {
  onBack: () => void
  onReview: (documentId: number) => void
  onUnauthorized: () => void
}

export default function SavedRecordsPage({ onBack, onReview, onUnauthorized }: Props) {
  const [state, setState] = useState<SavedRecordsState>('loading')
  const [records, setRecords] = useState<AcceptedDocumentRecord[]>([])
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)

  const load = useCallback(async () => {
    setState('loading')
    setError(null)
    setWarning(null)

    try {
      const { records, warnings } = await listAcceptedDocuments()
      setRecords(records)
      if (warnings?.length) {
        setWarning(`${warnings.length} saved record${warnings.length === 1 ? '' : 's'} could not be decrypted with the current encryption key.`)
      }
      setState('ready')
    } catch (err) {
      if (isUnauthorizedError(err)) {
        onUnauthorized()
        return
      }

      setError(err instanceof Error ? err.message : 'Could not load saved records.')
      setState('error')
    }
  }, [onUnauthorized])

  useEffect(() => {
    load()
  }, [load])

  return (
    <section className="records-page">
      <div className="records-toolbar">
        <div>
          <p className="eyebrow">Saved records</p>
          <h1>Accepted tax values</h1>
          <p className="page-subtitle">Accepted documents saved for the signed-in user.</p>
        </div>
        <div className="button-row">
          <button className="button button-secondary" onClick={load} disabled={state === 'loading'}>
            Refresh
          </button>
          <button className="button button-primary" onClick={onBack}>
            Upload
          </button>
        </div>
      </div>

      {state === 'loading' && (
        <div className="panel state-panel">
          <div className="spinner" />
          <h1>Loading saved records</h1>
        </div>
      )}

      {state === 'error' && (
        <div className="panel state-panel">
          <p className="alert alert-error">{error}</p>
          <div className="button-row">
            <button className="button button-primary" onClick={load}>Try again</button>
            <button className="button button-secondary" onClick={onBack}>Back to upload</button>
          </div>
        </div>
      )}

      {state === 'ready' && warning && <p className="alert alert-warning">{warning}</p>}

      {state === 'ready' && records.length === 0 && (
        <div className="panel state-panel">
          <h1>No accepted records</h1>
          <p className="muted">Accepted documents for this user will appear here.</p>
        </div>
      )}

      {state === 'ready' && records.length > 0 && (
        <div className="records-scroll" aria-label="Accepted records">
          {records.map(record => (
            <article className="panel record-card" key={record.id}>
              <div className="record-card-header">
                <div>
                  <p className="eyebrow">Document #{record.id}</p>
                  <h2>{record.filename}</h2>
                </div>
                <div className="record-meta">
                  <span>{new Date(record.accepted_at).toLocaleString()}</span>
                  <button className="button button-secondary" onClick={() => onReview(record.id)}>
                    Open
                  </button>
                </div>
              </div>

              <dl className="saved-values-list">
                {FIELD_LABELS.map(({ key, label }) => (
                  <div className="saved-value-row" key={key}>
                    <dt>{label}</dt>
                    <dd>{record.fields[key]}</dd>
                  </div>
                ))}
              </dl>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
