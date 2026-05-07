export type DocumentStatus = 'pending' | 'processing' | 'extracted' | 'accepted'

export type UploadResponse = {
  documentId: number
  replaced: boolean
}
