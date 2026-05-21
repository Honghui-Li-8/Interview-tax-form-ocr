import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import type { SupportedTaxFormType } from '../../../shared/types'
import {
  DEFAULT_TAX_YEAR,
  EXPECTED_PACKET_FORM_KEYS,
  FORM_TYPE_TO_PACKET_KEY,
  getAllSchemas,
  getClaudeFieldSchema,
  getDefaultSchema,
  SUPPORTED_FORM_TYPES,
  TAX_FORM_INVENTORY,
  TAX_FORM_SCHEMA_VERSION,
} from './taxFormSchemas'

const repoRoot = path.resolve(__dirname, '../../..')
const documentsRoot = path.join(repoRoot, 'shared/documents/2025')

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function fieldKeysFor(formType: SupportedTaxFormType): string[] {
  return getDefaultSchema(formType).fields.map(field => field.key).sort()
}

describe('tax form schema registry', () => {
  it('loads the 2025 inventory for every supported form', () => {
    expect(DEFAULT_TAX_YEAR).toBe('2025')
    expect(TAX_FORM_SCHEMA_VERSION).toBe(1)
    expect(getAllSchemas()).toHaveLength(SUPPORTED_FORM_TYPES.length)
    expect(EXPECTED_PACKET_FORM_KEYS).toHaveLength(SUPPORTED_FORM_TYPES.length)

    for (const formType of SUPPORTED_FORM_TYPES) {
      const schema = getDefaultSchema(formType)
      const inventoryForm = TAX_FORM_INVENTORY.forms[formType]

      expect(schema.taxYear).toBe('2025')
      expect(schema.formType).toBe(formType)
      expect(schema.title).toBe(inventoryForm.title)
      expect(schema.fields).toHaveLength(inventoryForm.fields.length)
      expect(schema.fields.length).toBeGreaterThan(0)
      expect(FORM_TYPE_TO_PACKET_KEY[formType]).toBeTruthy()
    }
  })

  it('keeps field keys unique and value types valid', () => {
    const allowedValueTypes = new Set([
      'text',
      'money',
      'number',
      'checkbox',
      'date',
      'ssn',
      'ein',
      'signature',
      'boolean',
    ])

    for (const schema of getAllSchemas()) {
      const keys = schema.fields.map(field => field.key)
      expect(new Set(keys).size).toBe(keys.length)

      for (const field of schema.fields) {
        expect(field.key).toBeTruthy()
        expect(field.label).toBeTruthy()
        expect(field.section).toBeTruthy()
        expect(allowedValueTypes.has(field.valueType)).toBe(true)
      }
    }
  })

  it('returns prompt-safe schemas for one selected form only', () => {
    const scheduleA = getClaudeFieldSchema('Schedule A')
    const scheduleB = getClaudeFieldSchema('Schedule B')

    expect(scheduleA).toHaveLength(getDefaultSchema('Schedule A').fields.length)
    expect(scheduleB).toHaveLength(getDefaultSchema('Schedule B').fields.length)
    expect(scheduleA.map(field => field.key)).not.toEqual(scheduleB.map(field => field.key))
  })

  it('keeps parsed and empty examples aligned with schema field keys', () => {
    for (const kind of ['parsed_example', 'empty_example'] as const) {
      const index = readJson(path.join(documentsRoot, kind, 'index.json')) as {
        taxYear: string
        files: Array<{ formType: SupportedTaxFormType; file: string }>
      }

      expect(index.taxYear).toBe(DEFAULT_TAX_YEAR)
      expect(index.files).toHaveLength(SUPPORTED_FORM_TYPES.length)

      for (const { formType, file } of index.files) {
        const example = readJson(path.join(documentsRoot, kind, file)) as {
          formType: SupportedTaxFormType
          fields: Record<string, unknown>
        }

        expect(example.formType).toBe(formType)
        expect(Object.keys(example.fields).sort()).toEqual(fieldKeysFor(formType))
      }
    }
  })

  it('indexes official blank PDFs for every supported form', () => {
    const index = readJson(path.join(documentsRoot, 'official_doc/index.json')) as {
      taxYear: string
      forms: Array<{ formType: SupportedTaxFormType; file: string }>
    }

    expect(index.taxYear).toBe(DEFAULT_TAX_YEAR)
    expect(index.forms.map(form => form.formType)).toEqual([...SUPPORTED_FORM_TYPES])

    for (const form of index.forms) {
      expect(fs.existsSync(path.join(documentsRoot, 'official_doc', form.file))).toBe(true)
    }
  })
})
