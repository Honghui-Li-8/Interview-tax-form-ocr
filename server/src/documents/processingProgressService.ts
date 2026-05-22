import type {
  ProcessingProgressEvent,
  ProcessingProgressPhase,
  SupportedTaxFormType,
} from '../../../shared/types'
import { logSafeProgress } from './safeLogger'

export type ProcessingProgressInput = {
  phase: ProcessingProgressPhase
  message: string
  percent?: number | null
  pageCount?: number
  currentPage?: number
  pageNumbers?: number[]
  formType?: SupportedTaxFormType
  formIndex?: number
  formCount?: number
  warningCodes?: string[]
}

type Subscriber = (event: ProcessingProgressEvent) => void

type ProgressEntry = {
  sequence: number
  latest: ProcessingProgressEvent | null
  history: ProcessingProgressEvent[]
  subscribers: Set<Subscriber>
  cleanupTimer?: NodeJS.Timeout
}

const MAX_HISTORY = 50
const TERMINAL_CLEANUP_MS = 10 * 60 * 1000
const entries = new Map<number, ProgressEntry>()

function isTerminalPhase(phase: ProcessingProgressPhase): boolean {
  return phase === 'completed' || phase === 'failed'
}

function getOrCreateEntry(documentId: number): ProgressEntry {
  const existing = entries.get(documentId)
  if (existing) return existing

  const entry: ProgressEntry = {
    sequence: 0,
    latest: null,
    history: [],
    subscribers: new Set(),
  }
  entries.set(documentId, entry)
  return entry
}

function assertValidDocumentId(documentId: number): void {
  if (!Number.isInteger(documentId) || documentId <= 0) {
    throw new Error(`Invalid progress document ID: ${documentId}`)
  }
}

export function emitProcessingProgress(
  documentId: number,
  input: ProcessingProgressInput
): ProcessingProgressEvent {
  assertValidDocumentId(documentId)
  const entry = getOrCreateEntry(documentId)

  if (entry.cleanupTimer) {
    clearTimeout(entry.cleanupTimer)
    entry.cleanupTimer = undefined
  }

  const event: ProcessingProgressEvent = {
    documentId,
    phase: input.phase,
    message: input.message,
    timestamp: new Date().toISOString(),
    sequence: ++entry.sequence,
    percent: input.percent ?? null,
    pageCount: input.pageCount,
    currentPage: input.currentPage,
    pageNumbers: input.pageNumbers,
    formType: input.formType,
    formIndex: input.formIndex,
    formCount: input.formCount,
    warningCodes: input.warningCodes,
  }

  entry.latest = event
  entry.history.push(event)
  if (entry.history.length > MAX_HISTORY) {
    entry.history.splice(0, entry.history.length - MAX_HISTORY)
  }

  logSafeProgress(event)
  for (const subscriber of entry.subscribers) {
    subscriber(event)
  }

  if (isTerminalPhase(event.phase)) {
    entry.cleanupTimer = setTimeout(() => clearProcessingProgress(documentId), TERMINAL_CLEANUP_MS)
  }

  return event
}

export function subscribeProcessingProgress(
  documentId: number,
  subscriber: Subscriber
): () => void {
  assertValidDocumentId(documentId)
  const entry = getOrCreateEntry(documentId)
  entry.subscribers.add(subscriber)

  if (entry.latest) {
    subscriber(entry.latest)
  }

  return () => {
    entry.subscribers.delete(subscriber)
  }
}

export function getLatestProcessingProgress(documentId: number): ProcessingProgressEvent | null {
  assertValidDocumentId(documentId)
  return entries.get(documentId)?.latest ?? null
}

export function clearProcessingProgress(documentId: number): void {
  const entry = entries.get(documentId)
  if (entry?.cleanupTimer) clearTimeout(entry.cleanupTimer)
  entries.delete(documentId)
}

export function getProcessingProgressSubscriberCount(documentId: number): number {
  return entries.get(documentId)?.subscribers.size ?? 0
}
