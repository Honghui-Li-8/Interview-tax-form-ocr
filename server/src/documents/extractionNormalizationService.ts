import type {
  ExtractedField,
  ExtractedFieldValue,
  ExtractedScalarValue,
  ParsedTaxForm,
} from '../../../shared/types'
import type { TaxFormFieldSchema, TaxFormSchema } from './taxFormSchemas'

function isBlankScalar(value: ExtractedScalarValue): boolean {
  return typeof value === 'string' && value.trim() === ''
}

function normalizeTextValue(value: ExtractedScalarValue): ExtractedScalarValue {
  return typeof value === 'string' ? value.trim() || null : value
}

export function normalizeMoneyValue(value: ExtractedScalarValue): string | null {
  if (value === null || typeof value === 'boolean' || isBlankScalar(value)) return null
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  const isParenthesizedNegative = /^\(.+\)$/.test(trimmed)
  const cleaned = trimmed.replace(/[,$()\s]/g, '')
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return trimmed

  const normalized = isParenthesizedNegative && !cleaned.startsWith('-')
    ? `-${cleaned}`
    : cleaned
  return normalized
}

export function normalizeBooleanValue(value: ExtractedScalarValue): boolean | null {
  if (value === null || isBlankScalar(value)) return null
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return null

  const normalized = value.trim().toLowerCase()
  if (['checked', 'yes', 'true', 'x', 'selected', '1'].includes(normalized)) return true
  if (['unchecked', 'no', 'false', 'not checked', '0'].includes(normalized)) return false
  return null
}

export function normalizeIdentifierValue(
  value: ExtractedScalarValue,
  valueType: TaxFormFieldSchema['valueType']
): string | null {
  if (value === null || typeof value === 'boolean' || isBlankScalar(value)) return null
  if (typeof value !== 'string') return null

  const digits = value.replace(/\D/g, '')
  if (valueType === 'ssn' && digits.length === 9) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`
  }
  if (valueType === 'ein' && digits.length === 9) {
    return `${digits.slice(0, 2)}-${digits.slice(2)}`
  }
  return value.trim()
}

export function normalizeDateValue(value: ExtractedScalarValue): string | null {
  if (value === null || typeof value === 'boolean' || isBlankScalar(value)) return null
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (isoMatch) return trimmed

  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (slashMatch) {
    const month = slashMatch[1].padStart(2, '0')
    const day = slashMatch[2].padStart(2, '0')
    return `${slashMatch[3]}-${month}-${day}`
  }

  return trimmed
}

function normalizeScalarValue(
  value: ExtractedScalarValue,
  fieldSchema: TaxFormFieldSchema
): ExtractedScalarValue {
  switch (fieldSchema.valueType) {
    case 'money':
      return normalizeMoneyValue(value)
    case 'checkbox':
    case 'boolean':
      return normalizeBooleanValue(value)
    case 'ssn':
    case 'ein':
      return normalizeIdentifierValue(value, fieldSchema.valueType)
    case 'date':
      return normalizeDateValue(value)
    default:
      return normalizeTextValue(value)
  }
}

function normalizeFieldValue(
  value: ExtractedFieldValue,
  fieldSchema: TaxFormFieldSchema
): ExtractedFieldValue {
  if (Array.isArray(value)) {
    return value.map(row => normalizeRow(row, fieldSchema))
  }
  if (value && typeof value === 'object') {
    return normalizeRow(value, fieldSchema)
  }
  return normalizeScalarValue(value, fieldSchema)
}

function normalizeRow(
  row: Record<string, ExtractedScalarValue>,
  fieldSchema: TaxFormFieldSchema
): Record<string, ExtractedScalarValue> {
  const allowedColumns = fieldSchema.columns ? new Set(fieldSchema.columns) : null
  const normalized: Record<string, ExtractedScalarValue> = {}

  for (const [column, value] of Object.entries(row)) {
    if (allowedColumns && !allowedColumns.has(column)) continue
    normalized[column] = normalizeTextValue(value)
  }

  if (allowedColumns) {
    for (const column of allowedColumns) {
      if (!(column in normalized)) normalized[column] = null
    }
  }

  return normalized
}

export function normalizeExtractedField(
  field: ExtractedField,
  fieldSchema: TaxFormFieldSchema
): ExtractedField {
  return {
    ...field,
    value: normalizeFieldValue(field.value, fieldSchema),
    confidence: field.confidence ?? 'unknown',
    rawText: typeof field.rawText === 'string' ? field.rawText.trim() || null : null,
  }
}

export function normalizeParsedForm(form: ParsedTaxForm, schema: TaxFormSchema): ParsedTaxForm {
  return {
    ...form,
    fields: Object.fromEntries(schema.fields.map(fieldSchema => {
      const field = form.fields[fieldSchema.key]
      return [fieldSchema.key, normalizeExtractedField(field, fieldSchema)]
    })),
  }
}
