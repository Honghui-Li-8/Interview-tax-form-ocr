import { describe, expect, it } from 'vitest'
import type { ExtractedField, PageClassification, ParsedTaxForm } from '../../../shared/types'
import { normalizeParsedForm } from './extractionNormalizationService'
import {
  createEmptyParsedForm,
  loadEmptyParsedFormExample,
  validatePageClassifications,
  validateParsedForm,
} from './extractionValidationService'
import type { RenderedPage } from './pageRenderService'
import { groupPagesByForm, mergeParsedForms } from './taxPacketMergeService'
import { getDefaultSchema } from './taxFormSchemas'

const renderedPages: RenderedPage[] = [
  { pageNumber: 1, imagePath: '/tmp/page-1.png', mimeType: 'image/png' },
  { pageNumber: 2, imagePath: '/tmp/page-2.png', mimeType: 'image/png' },
]

function field(value: ExtractedField['value'], sourcePage = 1): ExtractedField {
  return {
    value,
    confidence: 'high',
    sourcePage,
    rawText: typeof value === 'string' ? ` ${value} ` : null,
  }
}

function parsed1040(overrides: Record<string, ExtractedField> = {}): ParsedTaxForm {
  const schema = getDefaultSchema('1040')
  return {
    formType: '1040',
    present: true,
    taxYear: '2025',
    sourcePages: [1],
    fields: Object.fromEntries(schema.fields.map(schemaField => [
      schemaField.key,
      overrides[schemaField.key] ?? field(null),
    ])),
  }
}

describe('extraction validation and normalization utilities', () => {
  it('validates page classifications and rejects duplicate pages', () => {
    const classifications = validatePageClassifications([
      { pageNumber: 1, formType: '1040', taxYear: '2025', pageRole: 'page 1', confidence: 'high' },
      { pageNumber: 2, formType: 'Unknown', taxYear: null, pageRole: null, confidence: 'low' },
    ], renderedPages)

    expect(classifications).toHaveLength(2)
    expect(() => validatePageClassifications([
      { pageNumber: 1, formType: '1040', confidence: 'high' },
      { pageNumber: 1, formType: '1040', confidence: 'high' },
    ], renderedPages)).toThrow('Duplicate page classification')
  })

  it('validates parsed forms against schema keys and source pages', () => {
    const schema = getDefaultSchema('1040')
    const parsed = validateParsedForm('1040', parsed1040(), schema, [1])

    expect(Object.keys(parsed.fields)).toHaveLength(schema.fields.length)
    expect(() => validateParsedForm('1040', {
      ...parsed1040(),
      fields: { taxpayerFirstNameMiddleInitial: field('Ada') },
    }, schema, [1])).toThrow('missing schema field key')
    expect(() => validateParsedForm('1040', parsed1040({
      taxpayerFirstNameMiddleInitial: field('Ada', 2),
    }), schema, [1])).toThrow('invalid sourcePage')
  })

  it('normalizes money, booleans, identifiers, dates, blanks, raw text, and table rows', () => {
    const schema = getDefaultSchema('1040')
    const normalized = normalizeParsedForm(parsed1040({
      line1a: field('$1,234.00'),
      filingStatusSingle: field('checked'),
      taxpayerSsn: field('123456789'),
      taxpayerSignatureDate: field('5/21/2026'),
      digitalAssetsYes: field(''),
      dependents: field([{ firstName: ' Grace ', ssn: ' 111223333 ', unknown: 'drop' }]),
    }), schema)

    expect(normalized.fields.line1a.value).toBe('1234.00')
    expect(normalized.fields.filingStatusSingle.value).toBe(true)
    expect(normalized.fields.taxpayerSsn.value).toBe('123-45-6789')
    expect(normalized.fields.taxpayerSignatureDate.value).toBe('2026-05-21')
    expect(normalized.fields.digitalAssetsYes.value).toBeNull()
    expect(normalized.fields.line1a.rawText).toBe('$1,234.00')
    expect(normalized.fields.dependents.value).toEqual([{
      firstName: 'Grace',
      lastName: null,
      ssn: '111223333',
      relationship: null,
      livedWithYouMoreThanHalfYear: null,
      livedInUsMoreThanHalfYear: null,
      fullTimeStudent: null,
      permanentlyTotallyDisabled: null,
      childTaxCredit: null,
      creditForOtherDependents: null,
    }])
  })

  it('creates and loads empty parsed forms aligned with schema', () => {
    const schema = getDefaultSchema('Schedule 1')
    const empty = createEmptyParsedForm('Schedule 1', schema)
    const example = loadEmptyParsedFormExample('Schedule 1')

    expect(empty.present).toBe(false)
    expect(Object.keys(empty.fields).sort()).toEqual(schema.fields.map(field => field.key).sort())
    expect(Object.keys(example.fields).sort()).toEqual(schema.fields.map(field => field.key).sort())
  })
})

describe('tax packet merge utilities', () => {
  it('groups rendered pages by supported form classification', () => {
    const classifications = validatePageClassifications([
      { pageNumber: 1, formType: '1040', taxYear: '2025', pageRole: null, confidence: 'high' },
      { pageNumber: 2, formType: 'Unknown', taxYear: null, pageRole: null, confidence: 'low' },
    ], renderedPages)

    const grouped = groupPagesByForm(classifications, renderedPages)

    expect(grouped.get('1040')?.map(page => page.pageNumber)).toEqual([1])
    expect(grouped.has('Schedule 1')).toBe(false)
  })

  it('merges parsed forms into packet shape with unknown and missing-form warnings', () => {
    const classifications: PageClassification[] = [
      { pageNumber: 1, formType: '1040', taxYear: '2025', pageRole: null, confidence: 'high' },
      { pageNumber: 2, formType: 'Unknown', taxYear: null, pageRole: null, confidence: 'low' },
    ]
    const normalized1040 = normalizeParsedForm(parsed1040({
      taxpayerFirstNameMiddleInitial: field('Ada'),
      taxpayerLastName: field('Lovelace'),
      filingStatusSingle: field(true),
      line9: field('1234'),
      line24: field('120'),
      line34: field('20'),
    }), getDefaultSchema('1040'))

    const packet = mergeParsedForms(classifications, { '1040': normalized1040 })

    expect(packet.forms.form1040.present).toBe(true)
    expect(packet.forms.schedule1.present).toBe(false)
    expect(packet.summary).toMatchObject({
      taxpayerName: 'Ada Lovelace',
      filingStatus: 'Single',
      totalIncome: '1234',
      totalTax: '120',
      refundOrOwed: '20',
    })
    expect(packet.warnings.some(warning => warning.code === 'UNKNOWN_PAGE')).toBe(true)
    expect(packet.warnings.some(warning => warning.code === 'MISSING_SUPPORTED_FORM')).toBe(true)
  })
})
