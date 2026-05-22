export type DocumentStatus = 'pending' | 'processing' | 'extracted' | 'accepted' | 'failed'

export type SupportedTaxFormType =
  | '1040'
  | 'Schedule 1'
  | 'Schedule 2'
  | 'Schedule 3'
  | 'Schedule A'
  | 'Schedule B'
  | 'Schedule C'
  | 'Schedule D'
  | 'Schedule E'

export type ExtractionConfidence = 'high' | 'medium' | 'low' | 'unknown'

export type FieldValueType =
  | 'text'
  | 'money'
  | 'number'
  | 'checkbox'
  | 'date'
  | 'ssn'
  | 'ein'
  | 'signature'
  | 'boolean'

export type ExtractedScalarValue = string | boolean | null

export type ExtractedFieldValue =
  | ExtractedScalarValue
  | Record<string, ExtractedScalarValue>
  | Array<Record<string, ExtractedScalarValue>>

export type ExtractedField = {
  value: ExtractedFieldValue
  confidence: ExtractionConfidence
  sourcePage: number | null
  rawText: string | null
  reviewed?: boolean
  edited?: boolean
}

export type ParsedTaxForm = {
  formType: SupportedTaxFormType
  present: boolean
  taxYear: string | null
  sourcePages: number[]
  fields: Record<string, ExtractedField>
}

export type PageClassification = {
  pageNumber: number
  formType: SupportedTaxFormType | 'Unknown'
  taxYear: string | null
  pageRole: string | null
  confidence: ExtractionConfidence
}

export type ExtractionWarning = {
  severity: 'info' | 'warning' | 'error'
  code: string
  message: string
  fields: string[]
  pages: number[]
}

export type TaxReturnExtraction = {
  schemaVersion: 1
  taxYear: string | null
  sourceInventory: {
    taxYear: string
    schemaVersion: number
  }
  pages: PageClassification[]
  forms: {
    form1040: ParsedTaxForm
    schedule1: ParsedTaxForm
    schedule2: ParsedTaxForm
    schedule3: ParsedTaxForm
    scheduleA: ParsedTaxForm
    scheduleB: ParsedTaxForm
    scheduleC: ParsedTaxForm
    scheduleD: ParsedTaxForm
    scheduleE: ParsedTaxForm
  }
  warnings: ExtractionWarning[]
  summary: {
    taxpayerName: string | null
    filingStatus: string | null
    totalIncome: string | null
    totalTax: string | null
    refundOrOwed: string | null
  }
}

export type ProcessingProgressPhase =
  | 'idle'
  | 'claiming'
  | 'rendering_pages'
  | 'rendered_pages'
  | 'classifying_pages'
  | 'classified_pages'
  | 'extracting_form_group'
  | 'validating_form_group'
  | 'normalizing_form_group'
  | 'reconciling'
  | 'encrypting_and_persisting'
  | 'completed'
  | 'failed'

export type ProcessingProgressEvent = {
  documentId: number
  phase: ProcessingProgressPhase
  message: string
  timestamp: string
  sequence: number
  percent: number | null
  pageCount?: number
  currentPage?: number
  pageNumbers?: number[]
  formType?: SupportedTaxFormType
  formIndex?: number
  formCount?: number
  warningCodes?: string[]
}

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
  extraction: TaxReturnExtraction
  fields?: ExtractedFields
}

export type DocumentDetail = {
  id: number
  status: DocumentStatus
  fields: ExtractedFields | null
  extraction?: TaxReturnExtraction | null
  accepted_at: string | null
}

export type AcceptedDocumentRecord = {
  id: number
  filename: string
  fields: ExtractedFields
  extraction?: TaxReturnExtraction
  accepted_at: string
}

export type AcceptResponse = {
  accepted_at: string
}
