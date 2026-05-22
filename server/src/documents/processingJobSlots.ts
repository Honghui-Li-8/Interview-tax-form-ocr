type ProcessingJob = () => Promise<void>
type ProcessingSlotRelease = () => void

let activeJobCount = 0

function maxActiveProcessingJobs(): number {
  const value = Number(process.env.MAX_ACTIVE_PROCESSING_JOBS ?? '1')
  if (!Number.isInteger(value) || value < 1) return 1
  return value
}

export function tryStartProcessingJob(job: ProcessingJob): boolean {
  const release = tryReserveProcessingSlot()
  if (!release) return false

  startReservedProcessingJob(release, job)
  return true
}

export function tryReserveProcessingSlot(): ProcessingSlotRelease | null {
  if (activeJobCount >= maxActiveProcessingJobs()) return null

  activeJobCount += 1
  let released = false
  return () => {
    if (released) return
    released = true
    activeJobCount -= 1
  }
}

export function startReservedProcessingJob(release: ProcessingSlotRelease, job: ProcessingJob): void {
  void (async () => {
    try {
      await job()
    } catch {
      // Processing jobs own their failure handling.
    } finally {
      release()
    }
  })()
}

export function resetProcessingJobSlotsForTest(): void {
  activeJobCount = 0
}
