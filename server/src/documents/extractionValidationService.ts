import fs from 'fs'
import path from 'path'
import type {
  ExtractedField,
  ExtractedFieldValue,
  ExtractionConfidence,
  PageClassification,
  ParsedTaxForm,
  SupportedTaxFormType,
} from '../../../shared/types'
import type { RenderedPage } from './pageRenderService'
import {
  DEFAULT_TAX_YEAR,
  FORM_TYPE_TO_PACKET_KEY,
  SUPPORTED_FORM_TYPES,
  type TaxFormSchema,
} from './taxFormSchemas'

const CONFIDENCE_VALUES = new Set<ExtractionConfidence>(['high', 'medium', 'low', 'unknown'])
const SUPPORTED_FORM_SET = new Set<string>(SUPPORTED_FORM_TYPES)

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isValidFieldValue(value: unknown): value is ExtractedFieldValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true

  if (Array.isArray(value)) {
    return value.every(row => isRecord(row) && Object.values(row).every(isValidScalarValue))
  }

  return isRecord(value) && Object.values(value).every(isValidScalarValue)
}

function isValidScalarValue(value: unknown): value is string | boolean | null {
  return value === null || typeof value === 'string' || typeof value === 'boolean'
}

function asConfidence(value: unknown): ExtractionConfidence | undefined {
  return typeof value === 'string' && CONFIDENCE_VALUES.has(value as ExtractionConfidence)
    ? value as ExtractionConfidence
    : undefined
}

export function validatePageClassifications(
  value: unknown,
  renderedPages: RenderedPage[]
): PageClassification[] {
  if (!Array.isArray(value)) throw new Error('Page classifications must be an array')

  const renderedPageNumbers = new Set(renderedPages.map(page => page.pageNumber))
  const seen = new Set<number>()

  return value.map(item => {
    if (!isRecord(item)) throw new Error('Page classification must be an object')

    const pageNumber = item.pageNumber
    if (typeof pageNumber !== 'number' || !Number.isInteger(pageNumber)) {
      throw new Error('Page classification pageNumber must be an integer')
    }
    if (!renderedPageNumbers.has(pageNumber)) {
      throw new Error(`Page classification references unknown page ${pageNumber}`)
    }
    if (seen.has(pageNumber)) {
      throw new Error(`Duplicate page classification for page ${pageNumber}`)
    }
    seen.add(pageNumber)

    const formType = item.formType
    if (formType !== 'Unknown' && (typeof formType !== 'string' || !SUPPORTED_FORM_SET.has(formType))) {
      throw new Error(`Unsupported page classification formType: ${String(formType)}`)
    }

    const confidence = asConfidence(item.confidence)
    if (!confidence) throw new Error('Page classification confidence is invalid')

    return {
      pageNumber,
      formType: formType as PageClassification['formType'],
      taxYear: typeof item.taxYear === 'string' ? item.taxYear : null,
      pageRole: typeof item.pageRole === 'string' ? item.pageRole : null,
      confidence,
    }
  })
}

export function validateParsedForm(
  formType: SupportedTaxFormType,
  value: unknown,
  schema: TaxFormSchema,
  allowedPages: number[]
): ParsedTaxForm {
  if (!isRecord(value)) throw new Error('Parsed form must be an object')
  if (value.formType !== formType) throw new Error(`Parsed form type must be ${formType}`)

  const fields = value.fields
  if (!isRecord(fields)) throw new Error('Parsed form fields must be an object')

  const expectedKeys = new Set(schema.fields.map(field => field.key))
  const actualKeys = Object.keys(fields)
  for (const key of expectedKeys) {
    if (!(key in fields)) throw new Error(`Parsed form is missing schema field key: ${key}`)
  }
  for (const key of actualKeys) {
    if (!expectedKeys.has(key)) throw new Error(`Parsed form has unsupported field key: ${key}`)
  }

  const allowedPageSet = new Set(allowedPages)
  const parsedFields: Record<string, ExtractedField> = {}

  for (const key of actualKeys) {
    const field = fields[key]
    if (!isRecord(field)) throw new Error(`Parsed field ${key} must be an object`)
    if (!isValidFieldValue(field.value)) throw new Error(`Parsed field ${key} has invalid value`)

    const confidence = asConfidence(field.confidence) ?? 'unknown'
    const sourcePage = field.sourcePage
    if (sourcePage !== null && sourcePage !== undefined) {
      if (typeof sourcePage !== 'number' || !Number.isInteger(sourcePage) || !allowedPageSet.has(sourcePage)) {
        throw new Error(`Parsed field ${key} has invalid sourcePage`)
      }
    }

    parsedFields[key] = {
      value: field.value,
      confidence,
      sourcePage: sourcePage ?? null,
      rawText: typeof field.rawText === 'string' ? field.rawText : null,
      reviewed: typeof field.reviewed === 'boolean' ? field.reviewed : undefined,
      edited: typeof field.edited === 'boolean' ? field.edited : undefined,
    }
  }

  const sourcePages = Array.isArray(value.sourcePages)
    ? value.sourcePages.filter(page => typeof page === 'number' && Number.isInteger(page))
    : allowedPages

  if (sourcePages.some(page => !allowedPageSet.has(page))) {
    throw new Error('Parsed form sourcePages include pages outside the form group')
  }

  return {
    formType,
    present: value.present !== false,
    taxYear: typeof value.taxYear === 'string' ? value.taxYear : null,
    sourcePages,
    fields: parsedFields,
  }
}

export function createEmptyParsedForm(
  formType: SupportedTaxFormType,
  schema: TaxFormSchema,
  _warningCode?: string
): ParsedTaxForm {
  return {
    formType,
    present: false,
    taxYear: DEFAULT_TAX_YEAR,
    sourcePages: [],
    fields: Object.fromEntries(schema.fields.map(field => [
      field.key,
      {
        value: null,
        confidence: 'unknown',
        sourcePage: null,
        rawText: null,
      } satisfies ExtractedField,
    ])),
  }
}

export function loadEmptyParsedFormExample(
  formType: SupportedTaxFormType,
  taxYear = DEFAULT_TAX_YEAR
): ParsedTaxForm {
  if (taxYear !== DEFAULT_TAX_YEAR) throw new Error(`Unsupported tax year: ${taxYear}`)

  const packetKey = FORM_TYPE_TO_PACKET_KEY[formType]
  const exampleDir = path.resolve(process.cwd(), '../shared/documents/2025/empty_example')
  const index = JSON.parse(fs.readFileSync(path.join(exampleDir, 'index.json'), 'utf8')) as {
    files: Array<{ formType: SupportedTaxFormType; file: string }>
  }
  const entry = index.files.find(file => file.formType === formType)
  if (!entry) throw new Error(`Missing empty example for ${formType}`)

  const example = JSON.parse(fs.readFileSync(path.join(exampleDir, entry.file), 'utf8')) as ParsedTaxForm & {
    formKey?: string
  }
  if (example.formKey && example.formKey !== packetKey) {
    throw new Error(`Empty example form key mismatch for ${formType}`)
  }

  return example
}
