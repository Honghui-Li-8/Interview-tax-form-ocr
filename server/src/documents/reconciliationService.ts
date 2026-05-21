import type { ExtractionWarning, ParsedTaxForm, TaxReturnExtraction } from '../../../shared/types'

type ReconciliationCheck = {
  code: string
  message: string
  leftForm: keyof TaxReturnExtraction['forms']
  leftField: string
  rightForm: keyof TaxReturnExtraction['forms']
  rightField: string
}

const CHECKS: ReconciliationCheck[] = [
  {
    code: 'SCHEDULE_1_ADDITIONAL_INCOME_MISMATCH',
    message: 'Schedule 1 line 10 does not match Form 1040 line 8.',
    leftForm: 'schedule1',
    leftField: 'line10',
    rightForm: 'form1040',
    rightField: 'line8',
  },
  {
    code: 'SCHEDULE_2_ADDITIONAL_TAX_MISMATCH',
    message: 'Schedule 2 line 21 does not match Form 1040 line 23.',
    leftForm: 'schedule2',
    leftField: 'line21',
    rightForm: 'form1040',
    rightField: 'line23',
  },
  {
    code: 'SCHEDULE_3_NONREFUNDABLE_CREDIT_MISMATCH',
    message: 'Schedule 3 line 8 does not match Form 1040 line 20.',
    leftForm: 'schedule3',
    leftField: 'line8',
    rightForm: 'form1040',
    rightField: 'line20',
  },
  {
    code: 'SCHEDULE_3_REFUNDABLE_CREDIT_MISMATCH',
    message: 'Schedule 3 line 15 does not match Form 1040 line 31.',
    leftForm: 'schedule3',
    leftField: 'line15',
    rightForm: 'form1040',
    rightField: 'line31',
  },
  {
    code: 'SCHEDULE_A_ITEMIZED_DEDUCTION_MISMATCH',
    message: 'Schedule A line 17 does not match Form 1040 line 12e.',
    leftForm: 'scheduleA',
    leftField: 'line17',
    rightForm: 'form1040',
    rightField: 'line12e',
  },
  {
    code: 'SCHEDULE_C_BUSINESS_INCOME_MISMATCH',
    message: 'Schedule C line 31 does not match Schedule 1 line 3.',
    leftForm: 'scheduleC',
    leftField: 'line31',
    rightForm: 'schedule1',
    rightField: 'line3',
  },
  {
    code: 'SCHEDULE_D_CAPITAL_GAIN_MISMATCH',
    message: 'Schedule D line 16 does not match Form 1040 line 7a.',
    leftForm: 'scheduleD',
    leftField: 'line16',
    rightForm: 'form1040',
    rightField: 'line7a',
  },
  {
    code: 'SCHEDULE_E_SUPPLEMENTAL_INCOME_MISMATCH',
    message: 'Schedule E line 41 does not match Schedule 1 line 5.',
    leftForm: 'scheduleE',
    leftField: 'line41',
    rightForm: 'schedule1',
    rightField: 'line5',
  },
]

function moneyNumber(form: ParsedTaxForm, fieldKey: string): number | null {
  const value = form.fields[fieldKey]?.value
  if (typeof value !== 'string' || !value.trim()) return null

  const normalized = value.trim().replace(/[,$]/g, '')
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null

  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function pageFor(form: ParsedTaxForm, fieldKey: string): number[] {
  const sourcePage = form.fields[fieldKey]?.sourcePage
  return typeof sourcePage === 'number' ? [sourcePage] : form.sourcePages
}

export function reconcileTaxReturnExtraction(extraction: TaxReturnExtraction): TaxReturnExtraction {
  const warnings: ExtractionWarning[] = [...extraction.warnings]

  for (const check of CHECKS) {
    const leftForm = extraction.forms[check.leftForm]
    const rightForm = extraction.forms[check.rightForm]
    if (!leftForm.present || !rightForm.present) continue

    const leftValue = moneyNumber(leftForm, check.leftField)
    const rightValue = moneyNumber(rightForm, check.rightField)
    if (leftValue === null || rightValue === null || leftValue === rightValue) continue

    warnings.push({
      severity: 'warning',
      code: check.code,
      message: check.message,
      fields: [
        `${check.leftForm}.${check.leftField}`,
        `${check.rightForm}.${check.rightField}`,
      ],
      pages: [...new Set([
        ...pageFor(leftForm, check.leftField),
        ...pageFor(rightForm, check.rightField),
      ])].sort((a, b) => a - b),
    })
  }

  return { ...extraction, warnings }
}
