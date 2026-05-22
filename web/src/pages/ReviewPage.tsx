import { useState, useEffect, useRef, useCallback } from 'react'
import { getDocument, processDocument, acceptDocument, getDocumentFile, streamProcessingProgress } from '../api/documents'
import { isUnauthorizedError } from '../api/auth'
import type {
  DocumentDetail,
  ExtractedField,
  ExtractedFieldValue,
  ExtractedFields,
  ParsedTaxForm,
  ProcessingProgressEvent,
  TaxReturnExtraction,
} from '../../../shared/types'
import PdfViewer from '../components/PdfViewer'

type ReviewState = 'loading' | 'review' | 'submitting' | 'accepted' | 'error'
type PacketFormKey = keyof TaxReturnExtraction['forms']
type FormFields = Record<keyof ExtractedFields, string>
type ExtractionNotice = TaxReturnExtraction['warnings'][number]

const FORM_LABELS: Array<{ key: PacketFormKey; label: string }> = [
  { key: 'form1040', label: '1040' },
  { key: 'schedule1', label: 'Schedule 1' },
  { key: 'schedule2', label: 'Schedule 2' },
  { key: 'schedule3', label: 'Schedule 3' },
  { key: 'scheduleA', label: 'Schedule A' },
  { key: 'scheduleB', label: 'Schedule B' },
  { key: 'scheduleC', label: 'Schedule C' },
  { key: 'scheduleD', label: 'Schedule D' },
  { key: 'scheduleE', label: 'Schedule E' },
]

const LEGACY_FIELD_LABELS: { key: keyof ExtractedFields; label: string }[] = [
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
const PROCESS_TIMEOUT_MS = 15 * 60 * 1000
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

function valueToInput(value: ExtractedFieldValue): string {
  if (value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return JSON.stringify(value)
}

function inputToValue(input: string, previous: ExtractedFieldValue): ExtractedFieldValue {
  const trimmed = input.trim()
  if (!trimmed) return null
  if (typeof previous === 'boolean') return trimmed.toLowerCase() === 'true'
  if (Array.isArray(previous) || (previous && typeof previous === 'object')) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return previous
    }
  }
  return input
}

function fieldsFromDetail(doc: DocumentDetail): FormFields {
  return {
    taxpayerName: doc.fields?.taxpayerName ?? '',
    filingStatus: doc.fields?.filingStatus ?? '',
    totalWages:   doc.fields?.totalWages   ?? '',
    totalTax:     doc.fields?.totalTax     ?? '',
    refundOrOwed: doc.fields?.refundOrOwed ?? '',
  }
}

function firstPresentFormKey(extraction: TaxReturnExtraction | null): PacketFormKey | null {
  if (!extraction) return null
  return FORM_LABELS.find(({ key }) => extraction.forms[key].present)?.key ?? null
}

function visibleExtractionNotices(extraction: TaxReturnExtraction | null): ExtractionNotice[] {
  if (!extraction) return []
  return extraction.warnings.filter(warning =>
    warning.severity === 'error'
    || (warning.code === 'MISSING_SUPPORTED_FORM' && warning.message.includes('1040'))
  )
}

function formatProgressDetail(event: ProcessingProgressEvent | null): string | null {
  if (!event) return null
  if (event.formType && event.formIndex && event.formCount) {
    const pages = event.pageNumbers?.length ? ` from page ${event.pageNumbers.join(', ')}` : ''
    return `Form ${event.formIndex} of ${event.formCount}: ${event.formType}${pages}`
  }
  if (event.currentPage && event.pageCount) {
    return `Page ${event.currentPage} of ${event.pageCount}`
  }
  if (event.pageNumbers?.length && event.pageCount) {
    return `Pages ${event.pageNumbers.join(', ')} of ${event.pageCount}`
  }
  if (event.pageCount) {
    return `${event.pageCount} page${event.pageCount === 1 ? '' : 's'}`
  }
  return null
}

function progressPercent(event: ProcessingProgressEvent | null): number {
  if (!event || event.percent === null) return 0
  return Math.max(0, Math.min(100, event.percent))
}

export default function ReviewPage({ documentId, onBack, onUnauthorized }: Props) {
  const [state, setState] = useState<ReviewState>('loading')
  const [fields, setFields] = useState<FormFields>(EMPTY_FIELDS)
  const [extraction, setExtraction] = useState<TaxReturnExtraction | null>(null)
  const [selectedForm, setSelectedForm] = useState<PacketFormKey | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [acceptError, setAcceptError] = useState<string | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [acceptedAt, setAcceptedAt] = useState<string | null>(null)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [progressEvent, setProgressEvent] = useState<ProcessingProgressEvent | null>(null)
  const [progressFallback, setProgressFallback] = useState(false)
  const processStartedFor = useRef<number | null>(null)

  const waitForProcessing = useCallback(async (getCancelled: () => boolean): Promise<DocumentDetail> => {
    const startedAt = Date.now()

    while (!getCancelled()) {
      const doc = await getDocument(documentId)

      if (doc.status !== 'pending' && doc.status !== 'processing') {
        return doc
      }

      if (Date.now() - startedAt > PROCESS_TIMEOUT_MS) {
        const latestDoc = await getDocument(documentId)
        if (latestDoc.status !== 'pending' && latestDoc.status !== 'processing') {
          return latestDoc
        }

        throw new Error('Document processing is taking longer than expected. Please refresh and check the document status.')
      }

      await new Promise(resolve => setTimeout(resolve, PROCESS_POLL_INTERVAL_MS))
    }

    throw new Error('Document processing was cancelled.')
  }, [documentId])

  const load = useCallback(async (getCancelled: () => boolean = () => false) => {
    setState('loading')
    setLoadError(null)
    setProgressFallback(false)
    setProgressEvent(null)
    try {
      let doc = await getDocument(documentId)
      const shouldStreamProgress = doc.status === 'pending' || doc.status === 'processing'
      const progressController = shouldStreamProgress ? new AbortController() : null
      const progressPromise = progressController
        ? streamProcessingProgress(documentId, event => {
          if (getCancelled()) return
          setProgressEvent(event)
          if (import.meta.env.DEV) {
            console.debug('Processing progress', {
              documentId: event.documentId,
              phase: event.phase,
              percent: event.percent,
              pageCount: event.pageCount,
              currentPage: event.currentPage,
              pageNumbers: event.pageNumbers,
              formType: event.formType,
              formIndex: event.formIndex,
              formCount: event.formCount,
            })
          }
        }, progressController.signal).catch(err => {
          if (progressController.signal.aborted || getCancelled()) return
          if (isUnauthorizedError(err)) {
            onUnauthorized()
            return
          }
          setProgressFallback(true)
          if (import.meta.env.DEV) {
            console.debug('Processing progress stream unavailable', err)
          }
        })
        : null

      try {
        if (doc.status === 'pending' && processStartedFor.current !== documentId) {
          processStartedFor.current = documentId
          await processDocument(documentId)
          doc = await getDocument(documentId)
        }

        if (doc.status === 'pending' || doc.status === 'processing') {
          doc = await waitForProcessing(getCancelled)
        }
      } finally {
        progressController?.abort()
        await progressPromise
      }

      if (getCancelled()) return

      setFields(fieldsFromDetail(doc))
      setExtraction(doc.extraction ?? null)
      setAcceptedAt(doc.accepted_at)
      setSelectedForm(firstPresentFormKey(doc.extraction ?? null))
      setState(doc.status === 'accepted' ? 'accepted' : 'review')
    } catch (err) {
      if (getCancelled()) return
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

  useEffect(() => {
    let url: string | null = null
    getDocumentFile(documentId)
      .then(objectUrl => { url = objectUrl; setPdfUrl(objectUrl) })
      .catch(() => {})
    return () => {
      if (url) URL.revokeObjectURL(url)
      setPdfUrl(null)
    }
  }, [documentId])

  async function handleAccept(e: React.FormEvent) {
    e.preventDefault()
    if (!extraction) {
      const validationMessage = validateFields(fields)
      if (validationMessage) {
        setValidationError(validationMessage)
        return
      }
    }

    setValidationError(null)
    setAcceptError(null)
    setState('submitting')
    try {
      await acceptDocument(documentId, extraction ?? fields as unknown as ExtractedFields)
      const savedDocument = await getDocument(documentId)
      const savedExtraction = savedDocument.extraction ?? extraction
      setFields(fieldsFromDetail(savedDocument))
      setExtraction(savedExtraction)
      setSelectedForm(firstPresentFormKey(savedExtraction))
      setAcceptedAt(savedDocument.accepted_at)
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

  function handleLegacyFieldChange(key: keyof ExtractedFields, value: string) {
    setFields(prev => ({ ...prev, [key]: value }))
    setValidationError(null)
    setAcceptError(null)
  }

  function handlePacketFieldChange(formKey: PacketFormKey, fieldKey: string, value: string) {
    setExtraction(prev => {
      if (!prev) return prev
      const form = prev.forms[formKey]
      const previousField = form.fields[fieldKey]
      const nextField: ExtractedField = {
        ...previousField,
        value: inputToValue(value, previousField.value),
        reviewed: true,
        edited: true,
      }

      return {
        ...prev,
        forms: {
          ...prev.forms,
          [formKey]: {
            ...form,
            fields: {
              ...form.fields,
              [fieldKey]: nextField,
            },
          },
        },
      }
    })
    setAcceptError(null)
  }

  function validateFields(values: FormFields): string | null {
    const empty = LEGACY_FIELD_LABELS.find(({ key }) => !values[key].trim())
    if (empty) return `${empty.label} is required.`

    const tooLong = LEGACY_FIELD_LABELS.find(({ key }) => values[key].trim().length > MAX_FIELD_LENGTH)
    if (tooLong) return `${tooLong.label} is too long.`

    if (!FILING_STATUSES.has(values.filingStatus.trim())) {
      return 'Filing Status must match a valid 1040 filing status.'
    }

    const invalidMoney = LEGACY_FIELD_LABELS.find(({ key }) =>
      MONEY_FIELDS.includes(key) && !MONEY_PATTERN.test(values[key].trim())
    )
    if (invalidMoney) return `${invalidMoney.label} must be a valid dollar amount.`

    return null
  }

  function renderPacketFields(formKey: PacketFormKey, form: ParsedTaxForm, readOnly: boolean) {
    const entries = Object.entries(form.fields)
    return (
      <div className="packet-fields">
        {entries.map(([fieldKey, field]) => (
          <div
            className={[
              'packet-field-row',
              (field.confidence === 'low' || field.confidence === 'unknown')
                ? 'packet-field-row--uncertain'
                : '',
            ].join(' ').trim()}
            key={fieldKey}
          >
            <div className="packet-field-meta">
              <label htmlFor={`${formKey}-${fieldKey}`}>{fieldKey}</label>
              <span>
                {field.confidence}
                {field.sourcePage ? ` · page ${field.sourcePage}` : ''}
              </span>
            </div>
            <input
              id={`${formKey}-${fieldKey}`}
              type="text"
              value={valueToInput(field.value)}
              placeholder="Blank"
              disabled={readOnly}
              onChange={event => handlePacketFieldChange(formKey, fieldKey, event.target.value)}
            />
            {field.rawText && <p className="field-evidence">{field.rawText}</p>}
          </div>
        ))}
      </div>
    )
  }

  function renderLegacyFields(readOnly: boolean) {
    return (
      <div className="form-stack">
        {LEGACY_FIELD_LABELS.map(({ key, label }) => (
          <div className="field" key={key}>
            <label htmlFor={key}>{label}</label>
            <input
              id={key}
              type="text"
              value={fields[key]}
              placeholder="No value parsed"
              onChange={e => handleLegacyFieldChange(key, e.target.value)}
              disabled={readOnly}
            />
          </div>
        ))}
      </div>
    )
  }

  if (state === 'loading') {
    const detail = formatProgressDetail(progressEvent)
    const percent = progressPercent(progressEvent)
    return (
      <section className="panel state-panel processing-progress-panel">
        <div className="spinner" />
        <h1>Processing document</h1>
        <p className="muted">
          {progressEvent?.message ?? `Preparing document #${documentId} for extraction.`}
        </p>
        {detail && <p className="processing-progress-detail">{detail}</p>}
        <div className="processing-progress-track" aria-label="Processing progress">
          <div className="processing-progress-bar" style={{ width: `${percent}%` }} />
        </div>
        <p className="processing-progress-meta">
          {progressEvent ? progressEvent.phase.split('_').join(' ') : 'waiting for backend status'}
          {progressEvent?.timestamp ? ` · ${new Date(progressEvent.timestamp).toLocaleTimeString()}` : ''}
        </p>
        {progressFallback && (
          <p className="muted processing-progress-note">
            Live status is unavailable. The page is still checking the document status.
          </p>
        )}
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

  const isSubmitting = state === 'submitting'
  const isReadOnly = state === 'accepted'
  const selected = selectedForm && extraction ? extraction.forms[selectedForm] : null
  const visibleNotices = visibleExtractionNotices(extraction)

  return (
    <section className="page-grid packet-review-grid">
      <div className="page-intro">
        <p className="eyebrow">Document #{documentId}</p>
        <h1>{isReadOnly ? 'Document Accepted' : 'Review extracted data'}</h1>
        <p className="page-subtitle">
          {extraction
            ? `${extraction.sourceInventory.taxYear} packet extraction with ${visibleNotices.length} notice(s).`
            : 'Confirm each field before accepting the extracted result.'}
          {acceptedAt && ` Accepted at: ${new Date(acceptedAt).toLocaleString()}.`}
        </p>
        {pdfUrl && (
          <PdfViewer url={pdfUrl} onOpenInTab={() => { const tab = window.open('', '_blank'); tab?.location.replace(pdfUrl) }} />
        )}
        {visibleNotices.length > 0 && (
          <section className="packet-side-notices">
            <h2>Warnings</h2>
            {visibleNotices.map((warning, index) => (
              <p className={`alert ${warning.severity === 'error' ? 'alert-error' : 'alert-warning'}`} key={`${warning.code}-${index}`}>
                <strong>{warning.code}</strong>: {warning.message}
              </p>
            ))}
          </section>
        )}
      </div>

      <form className="panel packet-review-panel" onSubmit={handleAccept}>
        {extraction ? (
          <>
            <div className="packet-tabs" role="tablist" aria-label="Tax forms">
              {FORM_LABELS.map(({ key, label }) => {
                const isPresent = extraction.forms[key].present
                return (
                  <button
                    key={key}
                    type="button"
                    className={[
                      'packet-tab',
                      key === selectedForm ? 'active' : '',
                      !isPresent ? 'disabled' : '',
                    ].filter(Boolean).join(' ')}
                    disabled={!isPresent}
                    onClick={() => setSelectedForm(key)}
                  >
                    {label}
                  </button>
                )
              })}
            </div>

            {selected && selectedForm ? (
              <section className="packet-form-section">
                <div className="packet-form-heading">
                  <div>
                    <h2>{FORM_LABELS.find(form => form.key === selectedForm)?.label}</h2>
                    <p>{selected.present ? `Pages ${selected.sourcePages.join(', ') || 'unknown'}` : 'Not found in packet'}</p>
                  </div>
                  <span>{Object.keys(selected.fields).length} fields</span>
                </div>
                {renderPacketFields(selectedForm, selected, isReadOnly || isSubmitting)}
              </section>
            ) : (
              <section className="packet-empty-selection">
                <h2>No supported forms detected</h2>
                <p className="muted">The parser did not identify a selectable supported form in this PDF.</p>
              </section>
            )}
          </>
        ) : (
          renderLegacyFields(isReadOnly || isSubmitting)
        )}

        {validationError && <p className="alert alert-error">{validationError}</p>}
        {acceptError && <p className="alert alert-error">{acceptError}</p>}

        <div className="button-row">
          {!isReadOnly && (
            <button className="button button-primary" type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Accepting...' : 'Accept'}
            </button>
          )}
          <button className="button button-secondary" type="button" onClick={onBack} disabled={isSubmitting}>
            {isReadOnly ? 'Upload another document' : 'Back'}
          </button>
        </div>
      </form>
    </section>
  )
}
