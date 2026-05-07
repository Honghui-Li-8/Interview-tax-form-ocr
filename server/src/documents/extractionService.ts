import type { ExtractedFields } from '../../../shared/types'

const PATTERNS = {
  taxpayerName: /your first name and initial[^\n]*\n([^\n]+)/i,
  filingStatus: /(single|married filing jointly|married filing separately|head of household|qualifying surviving spouse)/i,
  totalWages:   /wages,\s*salaries[^\n]*\n\s*([\d,]+)/i,
  totalTax:     /\btotal tax\b[^\n]*\n?\s*([\d,]+)/i,
  refundOrOwed: /(?:amount refunded|amount you owe)[^\n]*\n?\s*([\d,]+)/i,
}

export function extractFields(ocrText: string): ExtractedFields {
  const extract = (p: RegExp) => p.exec(ocrText)?.[1]?.trim() ?? null
  return {
    taxpayerName: extract(PATTERNS.taxpayerName),
    filingStatus: extract(PATTERNS.filingStatus),
    totalWages:   extract(PATTERNS.totalWages),
    totalTax:     extract(PATTERNS.totalTax),
    refundOrOwed: extract(PATTERNS.refundOrOwed),
  }
}

export function getDemoFields(): ExtractedFields {
  return {
    taxpayerName: 'Jane A. Smith',
    filingStatus: 'Single',
    totalWages:   '72,500',
    totalTax:     '8,342',
    refundOrOwed: '1,204',
  }
}
