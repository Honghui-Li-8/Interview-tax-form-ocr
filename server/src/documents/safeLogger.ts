import type { ProcessingProgressEvent } from '../../../shared/types'

export function isDevObservabilityEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.DEBUG === 'true'
}

export function logSafeProgress(event: ProcessingProgressEvent): void {
  if (!isDevObservabilityEnabled()) return

  const safePayload = {
    documentId: event.documentId,
    phase: event.phase,
    sequence: event.sequence,
    percent: event.percent,
    pageCount: event.pageCount,
    currentPage: event.currentPage,
    pageNumbers: event.pageNumbers,
    formType: event.formType,
    formIndex: event.formIndex,
    formCount: event.formCount,
    warningCodeCount: event.warningCodes?.length ?? 0,
  }

  console.log(`[progress] ${JSON.stringify(safePayload)}`)
}
