import { describe, expect, test } from 'vitest'
import {
  clearProcessingProgress,
  emitProcessingProgress,
  getLatestProcessingProgress,
  getProcessingProgressSubscriberCount,
  subscribeProcessingProgress,
} from './processingProgressService'

describe('processingProgressService', () => {
  test('emits monotonic sequence numbers per document', () => {
    clearProcessingProgress(1)

    const first = emitProcessingProgress(1, { phase: 'claiming', message: 'Claiming document' })
    const second = emitProcessingProgress(1, { phase: 'rendering_pages', message: 'Rendering pages' })

    expect(first.sequence).toBe(1)
    expect(second.sequence).toBe(2)
    expect(getLatestProcessingProgress(1)).toEqual(second)
  })

  test('subscribers receive latest event plus future events', () => {
    clearProcessingProgress(2)
    const latest = emitProcessingProgress(2, { phase: 'claiming', message: 'Claiming document' })
    const received: ProcessingProgressEvent[] = []

    const unsubscribe = subscribeProcessingProgress(2, event => received.push(event))
    const next = emitProcessingProgress(2, { phase: 'completed', message: 'Completed' })

    expect(received).toEqual([latest, next])
    unsubscribe()
  })

  test('unsubscribe removes the subscriber', () => {
    clearProcessingProgress(3)

    const unsubscribe = subscribeProcessingProgress(3, () => undefined)
    expect(getProcessingProgressSubscriberCount(3)).toBe(1)

    unsubscribe()
    expect(getProcessingProgressSubscriberCount(3)).toBe(0)
  })

  test('rejects invalid document IDs', () => {
    expect(() => emitProcessingProgress(0, { phase: 'claiming', message: 'Claiming document' }))
      .toThrow('Invalid progress document ID')
  })
})
import type { ProcessingProgressEvent } from '../../../shared/types'
