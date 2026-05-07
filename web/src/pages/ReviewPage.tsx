import { useState, useEffect, useRef, useCallback } from 'react'
import { getDocument, processDocument, acceptDocument } from '../api/documents'
import { isUnauthorizedError } from '../api/auth'
import type { DocumentDetail, ExtractedFields } from '../../../shared/types'

type ReviewState = 'loading' | 'review' | 'submitting' | 'accepted' | 'error'

type FormFields = Record<keyof ExtractedFields, string>

const FIELD_LABELS: { key: keyof ExtractedFields; label: string }[] = [
  { key: 'taxpayerName',  label: 'Taxpayer Name' },
  { key: 'filingStatus',  label: 'Filing Status' },
  { key: 'totalWages',    label: 'Total Wages / Income' },
  { key: 'totalTax',      label: 'Total Tax' },
  { key: 'refundOrOwed',  label: 'Refund or Amount Owed' },
]

const EMPTY_FIELDS: FormFields = {
  taxpayerName: '', filingStatus: '', totalWages: '', totalTax: '', refundOrOwed: '',
}

const PROCESS_POLL_INTERVAL_MS = 1000
const PROCESS_TIMEOUT_MS = 30000
const FILING_STATUSES = new Set([
  'Single',
  'Married filing jointly',
  'Married filing separately',
  'Head of household',
  'Qualifying surviving spouse',
])
const MONEY_FIELDS: (keyof ExtractedFields)[] = ['totalWages', 'totalTax', 'refundOrOwed']
const MONEY_PATTERN = /^\$?\d{1,3}(,\d{3})*(\.\d{2})?$|^\$?\d+(\.\d{2})?$/
const MAX_FIELD_LENGTH = 80

type Props = {
  documentId: number
  onBack: () => void
  onUnauthorized: () => void
}

export default function ReviewPage({ documentId, onBack, onUnauthorized }: Props) {
  const [state, setState] = useState<ReviewState>('loading')
  const [fields, setFields] = useState<FormFields>(EMPTY_FIELDS)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [acceptError, setAcceptError] = useState<string | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [acceptedAt, setAcceptedAt] = useState<string | null>(null)
  const processStartedFor = useRef<number | null>(null)

  const waitForProcessing = useCallback(async (getCancelled: () => boolean): Promise<DocumentDetail> => {
    const startedAt = Date.now()

    while (!getCancelled()) {
      const doc = await getDocument(documentId)

      if (doc.status !== 'pending' && doc.status !== 'processing') {
        return doc
      }

      if (Date.now() - startedAt > PROCESS_TIMEOUT_MS) {
        throw new Error('Document processing is taking longer than expected. Please try again.')
      }

      await new Promise(resolve => setTimeout(resolve, PROCESS_POLL_INTERVAL_MS))
    }

    throw new Error('Document processing was cancelled.')
  }, [documentId])

  const load = useCallback(async (getCancelled: () => boolean = () => false) => {
    setState('loading')
    setLoadError(null)
    try {
      let doc = await getDocument(documentId)

      if (doc.status === 'pending' && processStartedFor.current !== documentId) {
        processStartedFor.current = documentId
        try {
          await processDocument(documentId)
        } catch (err) {
          const message = err instanceof Error ? err.message : ''
          if (!message.includes('Already processing') && !message.includes('Already processed')) {
            throw err
          }
        }
        doc = await getDocument(documentId)
      }

      if (doc.status === 'pending' || doc.status === 'processing') {
        doc = await waitForProcessing(getCancelled)
      }

      if (getCancelled()) {
        return
      }

      setFields({
        taxpayerName: doc.fields?.taxpayerName ?? '',
        filingStatus: doc.fields?.filingStatus ?? '',
        totalWages:   doc.fields?.totalWages   ?? '',
        totalTax:     doc.fields?.totalTax     ?? '',
        refundOrOwed: doc.fields?.refundOrOwed ?? '',
      })
      setState('review')
    } catch (err) {
      if (isUnauthorizedError(err)) {
        onUnauthorized()
        return
      }

      setLoadError(err instanceof Error ? err.message : 'Could not load document.')
      setState('error')
    }
  }, [documentId, onUnauthorized, waitForProcessing])

  useEffect(() => {
    let cancelled = false
    load(() => cancelled)

    return () => {
      cancelled = true
    }
  }, [load])

  async function handleAccept(e: React.FormEvent) {
    e.preventDefault()
    const validationMessage = validateFields(fields)
    if (validationMessage) {
      setValidationError(validationMessage)
      return
    }
    setValidationError(null)
    setAcceptError(null)
    setState('submitting')
    try {
      const { accepted_at } = await acceptDocument(documentId, fields as unknown as ExtractedFields)
      setAcceptedAt(accepted_at)
      setState('accepted')
    } catch (err) {
      if (isUnauthorizedError(err)) {
        onUnauthorized()
        return
      }

      const msg = err instanceof Error ? err.message : 'Accept failed. Please try again.'
      setAcceptError(msg.includes('Already accepted') ? 'This document has already been accepted.' : msg)
      setState('review')
    }
  }

  function handleFieldChange(key: keyof ExtractedFields, value: string) {
    setFields(prev => ({ ...prev, [key]: value }))
    setValidationError(null)
    setAcceptError(null)
  }

  function validateFields(values: FormFields): string | null {
    const empty = FIELD_LABELS.find(({ key }) => !values[key].trim())
    if (empty) return `${empty.label} is required.`

    const tooLong = FIELD_LABELS.find(({ key }) => values[key].trim().length > MAX_FIELD_LENGTH)
    if (tooLong) return `${tooLong.label} is too long.`

    if (!FILING_STATUSES.has(values.filingStatus.trim())) {
      return 'Filing Status must match a valid 1040 filing status.'
    }

    const invalidMoney = FIELD_LABELS.find(({ key }) =>
      MONEY_FIELDS.includes(key) && !MONEY_PATTERN.test(values[key].trim())
    )
    if (invalidMoney) return `${invalidMoney.label} must be a valid dollar amount.`

    return null
  }

  if (state === 'loading') {
    return (
      <section className="panel state-panel">
        <div className="spinner" />
        <h1>Processing document</h1>
        <p className="muted">Extracting fields from document #{documentId}.</p>
      </section>
    )
  }

  if (state === 'error') {
    return (
      <section className="panel state-panel">
        <p className="alert alert-error">{loadError}</p>
        <div className="button-row">
          <button className="button button-primary" onClick={() => load()}>Try again</button>
          <button className="button button-secondary" onClick={onBack}>Back to upload</button>
        </div>
      </section>
    )
  }

  if (state === 'accepted') {
    return (
      <section className="panel state-panel">
        <div className="status-icon">✓</div>
        <h1>Document Accepted</h1>
        <p className="muted">
          Your tax data has been saved.
          {acceptedAt && ` Accepted at: ${new Date(acceptedAt).toLocaleString()}`}
        </p>
        <button className="button button-primary" onClick={onBack}>Upload another document</button>
      </section>
    )
  }

  const isSubmitting = state === 'submitting'

  return (
    <section className="page-grid">
      <div className="page-intro">
        <p className="eyebrow">Document #{documentId}</p>
        <h1>Review extracted data</h1>
        <p className="page-subtitle">Confirm each field before accepting the OCR result.</p>
      </div>

      <form className="panel form-stack" onSubmit={handleAccept}>
        {FIELD_LABELS.map(({ key, label }) => (
          <div className="field" key={key}>
            <label htmlFor={key}>{label}</label>
            <input
              id={key}
              type="text"
              value={fields[key]}
              placeholder="No value parsed"
              onChange={e => handleFieldChange(key, e.target.value)}
              disabled={isSubmitting}
            />
          </div>
        ))}

        {validationError && (
          <p className="alert alert-error">{validationError}</p>
        )}
        {acceptError && (
          <p className="alert alert-error">{acceptError}</p>
        )}

        <div className="button-row">
          <button className="button button-primary" type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Accepting...' : 'Accept'}
          </button>
          <button className="button button-secondary" type="button" onClick={onBack} disabled={isSubmitting}>
            Back
          </button>
        </div>
      </form>
    </section>
  )
}
