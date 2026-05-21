import inventory from '../../../docs/tickets/phase-5-tax-form-field-inventory-2025.json'
import type { FieldValueType, SupportedTaxFormType } from '../../../shared/types'

export type TaxFormFieldSchema = {
  key: string
  label: string
  valueType: FieldValueType
  lineNumber: string | null
  section: string
  required: boolean
  repeatable?: boolean
  columns?: string[]
  notes?: string
}

export type TaxFormSchema = {
  taxYear: string
  formType: SupportedTaxFormType
  title: string
  fields: TaxFormFieldSchema[]
}

type InventoryField = {
  key: string
  label: string
  valueType: FieldValueType
  lineNumber?: string | null
  section: string
  required?: boolean
  repeatable?: boolean
  columns?: string[]
  notes?: string
}

type InventoryForm = {
  formType: SupportedTaxFormType
  title: string
  fields: InventoryField[]
}

type Inventory = {
  schemaVersion: number
  taxYear: string
  forms: Record<SupportedTaxFormType, InventoryForm>
}

export const TAX_FORM_INVENTORY = inventory as Inventory
export const DEFAULT_TAX_YEAR = TAX_FORM_INVENTORY.taxYear
export const TAX_FORM_SCHEMA_VERSION = TAX_FORM_INVENTORY.schemaVersion

export const SUPPORTED_FORM_TYPES = [
  '1040',
  'Schedule 1',
  'Schedule 2',
  'Schedule 3',
  'Schedule A',
  'Schedule B',
  'Schedule C',
  'Schedule D',
  'Schedule E',
] as const satisfies readonly SupportedTaxFormType[]

export const EXPECTED_PACKET_FORM_KEYS = [
  'form1040',
  'schedule1',
  'schedule2',
  'schedule3',
  'scheduleA',
  'scheduleB',
  'scheduleC',
  'scheduleD',
  'scheduleE',
] as const

export type ExpectedPacketFormKey = typeof EXPECTED_PACKET_FORM_KEYS[number]

export const FORM_TYPE_TO_PACKET_KEY: Record<SupportedTaxFormType, ExpectedPacketFormKey> = {
  '1040': 'form1040',
  'Schedule 1': 'schedule1',
  'Schedule 2': 'schedule2',
  'Schedule 3': 'schedule3',
  'Schedule A': 'scheduleA',
  'Schedule B': 'scheduleB',
  'Schedule C': 'scheduleC',
  'Schedule D': 'scheduleD',
  'Schedule E': 'scheduleE',
}

function toSchema(form: InventoryForm): TaxFormSchema {
  return {
    taxYear: DEFAULT_TAX_YEAR,
    formType: form.formType,
    title: form.title,
    fields: form.fields.map(field => ({
      key: field.key,
      label: field.label,
      valueType: field.valueType,
      lineNumber: field.lineNumber ?? null,
      section: field.section,
      required: field.required ?? false,
      repeatable: field.repeatable,
      columns: field.columns,
      notes: field.notes,
    })),
  }
}

const SCHEMAS_BY_FORM_TYPE = new Map<SupportedTaxFormType, TaxFormSchema>(
  SUPPORTED_FORM_TYPES.map(formType => {
    const form = TAX_FORM_INVENTORY.forms[formType]
    if (!form) throw new Error(`Missing tax form inventory for ${formType}`)
    return [formType, toSchema(form)]
  })
)

export function getSchema(
  formType: SupportedTaxFormType,
  taxYear = DEFAULT_TAX_YEAR
): TaxFormSchema {
  if (taxYear !== DEFAULT_TAX_YEAR) {
    throw new Error(`Unsupported tax year: ${taxYear}`)
  }

  const schema = SCHEMAS_BY_FORM_TYPE.get(formType)
  if (!schema) throw new Error(`Unsupported tax form: ${formType}`)
  return schema
}

export function getDefaultSchema(formType: SupportedTaxFormType): TaxFormSchema {
  return getSchema(formType, DEFAULT_TAX_YEAR)
}

export function getClaudeFieldSchema(
  formType: SupportedTaxFormType,
  taxYear = DEFAULT_TAX_YEAR
): TaxFormFieldSchema[] {
  return getSchema(formType, taxYear).fields.map(field => ({
    key: field.key,
    label: field.label,
    valueType: field.valueType,
    lineNumber: field.lineNumber,
    section: field.section,
    required: field.required,
    repeatable: field.repeatable,
    columns: field.columns,
    notes: field.notes,
  }))
}

export function getAllSchemas(taxYear = DEFAULT_TAX_YEAR): TaxFormSchema[] {
  return SUPPORTED_FORM_TYPES.map(formType => getSchema(formType, taxYear))
}
