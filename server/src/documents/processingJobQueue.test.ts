import { beforeEach, describe, expect, test, vi } from 'vitest'
import { enqueueProcessingJob, resetProcessingJobQueueForTest } from './processingJobQueue'

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

describe('processingJobQueue', () => {
  beforeEach(() => {
    delete process.env.MAX_ACTIVE_PROCESSING_JOBS
    resetProcessingJobQueueForTest()
  })

  test('runs one active job by default and drains queued jobs', async () => {
    const first = deferredJob()
    const second = deferredJob()

    enqueueProcessingJob(first.job)
    enqueueProcessingJob(second.job)

    expect(first.job).toHaveBeenCalledTimes(1)
    expect(second.job).not.toHaveBeenCalled()

    first.resolve()

    await vi.waitFor(() => {
      expect(second.job).toHaveBeenCalledTimes(1)
    })

    second.resolve()
  })

  test('allows configured concurrent jobs', () => {
    process.env.MAX_ACTIVE_PROCESSING_JOBS = '2'
    const first = deferredJob()
    const second = deferredJob()
    const third = deferredJob()

    enqueueProcessingJob(first.job)
    enqueueProcessingJob(second.job)
    enqueueProcessingJob(third.job)

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

    enqueueProcessingJob(first.job)
    enqueueProcessingJob(second.job)

    expect(first.job).toHaveBeenCalledTimes(1)
    expect(second.job).not.toHaveBeenCalled()

    first.resolve()
  })
})
