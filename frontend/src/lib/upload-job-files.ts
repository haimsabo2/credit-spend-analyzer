/** In-memory file handles for the active job (survives client-side route changes, not full page reload). */
const jobFiles = new Map<string, File[]>()

export function setJobFiles(jobId: string, files: File[]): void {
  jobFiles.set(jobId, files)
}

export function getJobFiles(jobId: string): File[] | undefined {
  return jobFiles.get(jobId)
}

export function clearJobFiles(jobId: string): void {
  jobFiles.delete(jobId)
}
