import { useState, useEffect, useRef } from 'react'
import { getDocument, processDocument, acceptDocument } from '../api/documents'
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

type Props = { documentId: number; onBack: () => void }

export default function ReviewPage({ documentId, onBack }: Props) {
  const [state, setState] = useState<ReviewState>('loading')
  const [fields, setFields] = useState<FormFields>(EMPTY_FIELDS)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [acceptError, setAcceptError] = useState<string | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [acceptedAt, setAcceptedAt] = useState<string | null>(null)
  const processStartedFor = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false
    load(() => cancelled)

    return () => {
      cancelled = true
    }
  }, [documentId])

  async function waitForProcessing(getCancelled: () => boolean): Promise<DocumentDetail> {
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
  }

  async function load(getCancelled: () => boolean = () => false) {
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
      setLoadError(err instanceof Error ? err.message : 'Could not load document.')
      setState('error')
    }
  }

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
      <div style={{ padding: '2rem', fontFamily: 'sans-serif', maxWidth: '480px' }}>
        <p>Processing document…</p>
      </div>
    )
  }

  if (state === 'error') {
    return (
      <div style={{ padding: '2rem', fontFamily: 'sans-serif', maxWidth: '480px' }}>
        <p style={{ color: 'red' }}>{loadError}</p>
        <button onClick={() => load()}>Try again</button>
        <button onClick={onBack} style={{ marginLeft: '1rem' }}>Back to upload</button>
      </div>
    )
  }

  if (state === 'accepted') {
    return (
      <div style={{ padding: '2rem', fontFamily: 'sans-serif', maxWidth: '480px' }}>
        <h1>Document Accepted</h1>
        <p style={{ color: 'green' }}>
          Your tax data has been saved.
          {acceptedAt && ` Accepted at: ${new Date(acceptedAt).toLocaleString()}`}
        </p>
        <button onClick={onBack}>Upload another document</button>
      </div>
    )
  }

  const isSubmitting = state === 'submitting'

  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif', maxWidth: '480px' }}>
      <h1>Review Extracted Data</h1>
      <p>Correct any fields if needed, then click Accept.</p>

      <form onSubmit={handleAccept}>
        {FIELD_LABELS.map(({ key, label }) => (
          <div key={key} style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.25rem' }}>{label}</label>
            <input
              type="text"
              value={fields[key]}
              placeholder="No value parsed"
              onChange={e => handleFieldChange(key, e.target.value)}
              disabled={isSubmitting}
              style={{ width: '100%', padding: '0.4rem', boxSizing: 'border-box' }}
            />
          </div>
        ))}

        {validationError && (
          <p style={{ color: 'red', marginBottom: '1rem' }}>{validationError}</p>
        )}
        {acceptError && (
          <p style={{ color: 'red', marginBottom: '1rem' }}>{acceptError}</p>
        )}

        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Accepting…' : 'Accept'}
        </button>
        <button type="button" onClick={onBack} disabled={isSubmitting} style={{ marginLeft: '1rem' }}>
          Back
        </button>
      </form>
    </div>
  )
}
