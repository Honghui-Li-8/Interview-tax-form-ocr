import { beforeEach, describe, expect, test, vi } from 'vitest'
import { resetProcessingJobSlotsForTest, tryStartProcessingJob } from './processingJobSlots'

function deferredJob() {
  let resolve!: () => void
  const promise = new Promise<void>(done => {
    resolve = done
  })

  return {
    resolve,
    job: vi.fn(() => promise),
  }
}

describe('processingJobSlots', () => {
  beforeEach(() => {
    delete process.env.MAX_ACTIVE_PROCESSING_JOBS
    resetProcessingJobSlotsForTest()
  })

  test('runs one active job by default and rejects extra jobs', () => {
    const first = deferredJob()
    const second = deferredJob()

    expect(tryStartProcessingJob(first.job)).toBe(true)
    expect(tryStartProcessingJob(second.job)).toBe(false)

    expect(first.job).toHaveBeenCalledTimes(1)
    expect(second.job).not.toHaveBeenCalled()

    first.resolve()
  })

  test('allows configured concurrent jobs', () => {
    process.env.MAX_ACTIVE_PROCESSING_JOBS = '2'
    const first = deferredJob()
    const second = deferredJob()
    const third = deferredJob()

    expect(tryStartProcessingJob(first.job)).toBe(true)
    expect(tryStartProcessingJob(second.job)).toBe(true)
    expect(tryStartProcessingJob(third.job)).toBe(false)

    expect(first.job).toHaveBeenCalledTimes(1)
    expect(second.job).toHaveBeenCalledTimes(1)
    expect(third.job).not.toHaveBeenCalled()

    first.resolve()
    second.resolve()
  })

  test('defaults invalid concurrency to one active job', () => {
    process.env.MAX_ACTIVE_PROCESSING_JOBS = '0'
    const first = deferredJob()
    const second = deferredJob()

    expect(tryStartProcessingJob(first.job)).toBe(true)
    expect(tryStartProcessingJob(second.job)).toBe(false)

    expect(first.job).toHaveBeenCalledTimes(1)
    expect(second.job).not.toHaveBeenCalled()

    first.resolve()
  })

  test('allows a new job after the active job finishes', async () => {
    const first = deferredJob()
    const second = deferredJob()

    expect(tryStartProcessingJob(first.job)).toBe(true)
    expect(tryStartProcessingJob(second.job)).toBe(false)

    first.resolve()

    await vi.waitFor(() => {
      expect(tryStartProcessingJob(second.job)).toBe(true)
    })
    expect(second.job).toHaveBeenCalledTimes(1)

    second.resolve()
  })
})
