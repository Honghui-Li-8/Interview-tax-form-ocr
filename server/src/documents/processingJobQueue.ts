type ProcessingJob = () => Promise<void>

let activeJobCount = 0
let queuedJobs: ProcessingJob[] = []

function maxActiveProcessingJobs(): number {
  const value = Number(process.env.MAX_ACTIVE_PROCESSING_JOBS ?? '1')
  if (!Number.isInteger(value) || value < 1) return 1
  return value
}

function drainProcessingQueue(): void {
  while (activeJobCount < maxActiveProcessingJobs() && queuedJobs.length > 0) {
    const job = queuedJobs.shift()
    if (!job) return

    activeJobCount += 1
    void (async () => {
      try {
        await job()
      } catch {
        // Processing jobs own their failure handling.
      } finally {
        activeJobCount -= 1
        drainProcessingQueue()
      }
    })()
  }
}

export function enqueueProcessingJob(job: ProcessingJob): void {
  queuedJobs.push(job)
  drainProcessingQueue()
}

export function resetProcessingJobQueueForTest(): void {
  activeJobCount = 0
  queuedJobs = []
}
