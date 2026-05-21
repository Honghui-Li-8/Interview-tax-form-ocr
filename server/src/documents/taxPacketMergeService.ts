import type {
  ExtractionWarning,
  PageClassification,
  ParsedTaxForm,
  SupportedTaxFormType,
  TaxReturnExtraction,
} from '../../../shared/types'
import type { RenderedPage } from './pageRenderService'
import { createEmptyParsedForm } from './extractionValidationService'
import {
  DEFAULT_TAX_YEAR,
  FORM_TYPE_TO_PACKET_KEY,
  getDefaultSchema,
  SUPPORTED_FORM_TYPES,
  TAX_FORM_SCHEMA_VERSION,
  type ExpectedPacketFormKey,
} from './taxFormSchemas'

export function groupPagesByForm(
  classifications: PageClassification[],
  renderedPages: RenderedPage[]
): Map<SupportedTaxFormType, RenderedPage[]> {
  const renderedByPage = new Map(renderedPages.map(page => [page.pageNumber, page]))
  const grouped = new Map<SupportedTaxFormType, RenderedPage[]>()

  for (const classification of classifications) {
    if (classification.formType === 'Unknown') continue
    const page = renderedByPage.get(classification.pageNumber)
    if (!page) continue
    grouped.set(classification.formType, [...(grouped.get(classification.formType) ?? []), page])
  }

  return grouped
}

function fieldString(form: ParsedTaxForm, key: string): string | null {
  const value = form.fields[key]?.value
  return typeof value === 'string' ? value : null
}

export function buildPacketSummary(forms: Record<ExpectedPacketFormKey, ParsedTaxForm>): TaxReturnExtraction['summary'] {
  const form1040 = forms.form1040
  const firstName = fieldString(form1040, 'taxpayerFirstNameMiddleInitial')
  const lastName = fieldString(form1040, 'taxpayerLastName')
  const filingStatus = [
    ['filingStatusSingle', 'Single'],
    ['filingStatusMarriedFilingJointly', 'Married filing jointly'],
    ['filingStatusMarriedFilingSeparately', 'Married filing separately'],
    ['filingStatusHeadOfHousehold', 'Head of household'],
    ['filingStatusQualifyingSurvivingSpouse', 'Qualifying surviving spouse'],
  ].find(([key]) => form1040.fields[key]?.value === true)?.[1] ?? null

  return {
    taxpayerName: [firstName, lastName].filter(Boolean).join(' ') || null,
    filingStatus,
    totalIncome: fieldString(form1040, 'line9'),
    totalTax: fieldString(form1040, 'line24'),
    refundOrOwed: fieldString(form1040, 'line34') ?? fieldString(form1040, 'line37'),
  }
}

function warningsForClassifications(classifications: PageClassification[]): ExtractionWarning[] {
  return classifications
    .filter(classification => classification.formType === 'Unknown')
    .map(classification => ({
      severity: 'warning',
      code: 'UNKNOWN_PAGE',
      message: `Page ${classification.pageNumber} was not recognized as a supported tax form.`,
      fields: [],
      pages: [classification.pageNumber],
    }))
}

export function mergeParsedForms(
  classifications: PageClassification[],
  parsedForms: Partial<Record<SupportedTaxFormType, ParsedTaxForm>>
): TaxReturnExtraction {
  const forms = {} as Record<ExpectedPacketFormKey, ParsedTaxForm>
  const warnings = warningsForClassifications(classifications)

  for (const formType of SUPPORTED_FORM_TYPES) {
    const packetKey = FORM_TYPE_TO_PACKET_KEY[formType]
    const parsedForm = parsedForms[formType]
    if (parsedForm) {
      forms[packetKey] = parsedForm
      continue
    }

    forms[packetKey] = createEmptyParsedForm(formType, getDefaultSchema(formType), 'MISSING_SUPPORTED_FORM')
    warnings.push({
      severity: 'info',
      code: 'MISSING_SUPPORTED_FORM',
      message: `${formType} was not found in the uploaded packet.`,
      fields: [],
      pages: [],
    })
  }

  const taxYears = classifications
    .map(classification => classification.taxYear)
    .filter((taxYear): taxYear is string => Boolean(taxYear))

  return {
    schemaVersion: 1,
    taxYear: taxYears[0] ?? DEFAULT_TAX_YEAR,
    sourceInventory: {
      taxYear: DEFAULT_TAX_YEAR,
      schemaVersion: TAX_FORM_SCHEMA_VERSION,
    },
    pages: classifications,
    forms,
    warnings,
    summary: buildPacketSummary(forms),
  }
}
