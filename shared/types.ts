export type DocumentStatus = 'pending' | 'processing' | 'extracted' | 'accepted' | 'failed'

export type UploadResponse = {
  documentId: number
  replaced: boolean
}

export type ExtractedFields = {
  taxpayerName: string | null
  filingStatus: string | null
  totalWages:   string | null
  totalTax:     string | null
  refundOrOwed: string | null
}

export type ProcessResponse = {
  documentId: number
  status: DocumentStatus
  fields: ExtractedFields
}
