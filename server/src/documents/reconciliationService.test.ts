import { describe, expect, it } from 'vitest'
import type { ExtractedField, ParsedTaxForm } from '../../../shared/types'
import { createEmptyParsedForm } from './extractionValidationService'
import { normalizeParsedForm } from './extractionNormalizationService'
import { reconcileTaxReturnExtraction } from './reconciliationService'
import { mergeParsedForms } from './taxPacketMergeService'
import { getDefaultSchema } from './taxFormSchemas'

function money(value: string, sourcePage: number): ExtractedField {
  return {
    value,
    confidence: 'high',
    sourcePage,
    rawText: value,
  }
}

function formWithMoney(formType: '1040' | 'Schedule 1', fields: Record<string, string>, page: number): ParsedTaxForm {
  const schema = getDefaultSchema(formType)
  const form = createEmptyParsedForm(formType, schema)
  form.present = true
  form.sourcePages = [page]
  for (const [key, value] of Object.entries(fields)) {
    form.fields[key] = money(value, page)
  }
  return normalizeParsedForm(form, schema)
}

describe('reconcileTaxReturnExtraction', () => {
  it('does not warn when related totals match', () => {
    const packet = mergeParsedForms([
      { pageNumber: 1, formType: '1040', taxYear: '2025', pageRole: null, confidence: 'high' },
      { pageNumber: 2, formType: 'Schedule 1', taxYear: '2025', pageRole: null, confidence: 'high' },
    ], {
      '1040': formWithMoney('1040', { line8: '$1,234.00' }, 1),
      'Schedule 1': formWithMoney('Schedule 1', { line10: '1234.00' }, 2),
    })

    const reconciled = reconcileTaxReturnExtraction(packet)

    expect(reconciled.warnings.some(warning =>
      warning.code === 'SCHEDULE_1_ADDITIONAL_INCOME_MISMATCH'
    )).toBe(false)
  })

  it('warns when Schedule 1 additional income does not match Form 1040', () => {
    const packet = mergeParsedForms([
      { pageNumber: 1, formType: '1040', taxYear: '2025', pageRole: null, confidence: 'high' },
      { pageNumber: 2, formType: 'Schedule 1', taxYear: '2025', pageRole: null, confidence: 'high' },
    ], {
      '1040': formWithMoney('1040', { line8: '1200' }, 1),
      'Schedule 1': formWithMoney('Schedule 1', { line10: '1234' }, 2),
    })

    const reconciled = reconcileTaxReturnExtraction(packet)

    expect(reconciled.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'SCHEDULE_1_ADDITIONAL_INCOME_MISMATCH',
        fields: ['schedule1.line10', 'form1040.line8'],
        pages: [1, 2],
      }),
    ]))
  })
})
