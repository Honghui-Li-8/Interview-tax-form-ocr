import type { ExtractedFields } from '../../../shared/types'

const EMPTY_FIELDS: ExtractedFields = {
  taxpayerName: null,
  filingStatus: null,
  totalWages: null,
  totalTax: null,
  refundOrOwed: null,
}

const MONEY_PATTERN = /\d[\d,]*/g
const SSN_ADJACENT_NAME_PATTERN = /^([A-Z][A-Za-z]*(?:\s+[A-Z]\.)?(?:\s+[A-Z][A-Za-z]*){1,2})\s+\d\w{5,}/

function lastMoneyValue(line: string): string | null {
  const values = line.match(MONEY_PATTERN)
  return values ? values[values.length - 1] : null
}

function parseMoney(value: string | null): number | null {
  if (!value) return null
  return Number(value.replace(/,/g, ''))
}

function formatMoney(value: number): string {
  return value.toLocaleString('en-US')
}

function getLines(ocrText: string): string[] {
  return ocrText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function findLine(lines: string[], predicate: (line: string) => boolean): string | undefined {
  return lines.find(predicate)
}

function extractTaxpayerName(lines: string[]): string | null {
  for (const line of lines) {
    const match = SSN_ADJACENT_NAME_PATTERN.exec(line)
    if (match) return match[1]
  }

  return null
}

function hasSpouseName(lines: string[]): boolean {
  const spouseMarkerIndex = lines.findIndex((line) =>
    /spouse.s first name|spouse's first name/i.test(line)
  )

  if (spouseMarkerIndex === -1) return false

  const nextLine = lines[spouseMarkerIndex + 1] ?? ''
  return SSN_ADJACENT_NAME_PATTERN.test(nextLine)
}

function extractFilingStatus(lines: string[]): string | null {
  if (hasSpouseName(lines)) {
    return 'Married filing jointly'
  }

  const filingStatusLine = findLine(lines, (line) => /filing status/i.test(line))
  if (!filingStatusLine) return null

  if (/single/i.test(filingStatusLine)) return 'Single'
  if (/married\s+fi?l?ing\s+joint/i.test(filingStatusLine)) return 'Married filing jointly'
  if (/married\s+fi?l?ing\s+separately/i.test(filingStatusLine)) return 'Married filing separately'
  if (/head\s+of\s+household/i.test(filingStatusLine)) return 'Head of household'
  if (/qualifying\s+(?:widow|surviving\s+spouse)/i.test(filingStatusLine)) {
    return 'Qualifying surviving spouse'
  }

  return null
}

function extractTotalWages(lines: string[]): string | null {
  const totalIncomeLine = findLine(lines, (line) =>
    /total\s*income/i.test(line) || /totalincome/i.test(line)
  )
  if (totalIncomeLine) return lastMoneyValue(totalIncomeLine)

  const wagesLine = findLine(lines, (line) => /wages,\s*salaries/i.test(line))
  return wagesLine ? lastMoneyValue(wagesLine) : null
}

function extractLineValue(lines: string[], lineNumber: number, labelPattern: RegExp): string | null {
  const bracketedLineNumber = new RegExp(`\\[\\s*${lineNumber}\\s*\\]`)
  const pipeLineNumber = new RegExp(`\\|\\s*${lineNumber}\\s*\\|`)
  const bareLineNumber = new RegExp(`^\\D*${lineNumber}\\b`)

  const line = findLine(lines, (candidate) =>
    labelPattern.test(candidate) ||
    bracketedLineNumber.test(candidate) ||
    pipeLineNumber.test(candidate) ||
    bareLineNumber.test(candidate)
  )

  if (!line) return null

  const explicitLineBox = new RegExp(`(?:\\[\\s*${lineNumber}\\s*\\]|\\|\\s*${lineNumber}\\s*\\|)(.*)$`)
  const explicitValueTail = explicitLineBox.exec(line)?.[1] ?? null
  if (explicitValueTail !== null) {
    return lastMoneyValue(explicitValueTail)
  }

  if (lineNumber >= 16) return null

  return lastMoneyValue(line)
}

function extractRefundOrOwed(lines: string[]): string | null {
  const refund = extractLineValue(lines, 34, /amount\s+you\s+overpaid|overpaid/i)
  const owed = extractLineValue(lines, 37, /amount\s+you\s+owe/i)

  const refundAmount = parseMoney(refund)
  if (refundAmount && refundAmount > 0) return refund

  const owedAmount = parseMoney(owed)
  if (owedAmount && owedAmount > 0) return owed

  return null
}

function extractTotalTax(lines: string[], refundOrOwed: string | null): string | null {
  const line24 = extractLineValue(lines, 24, /total\s*tax|totaltax/i)
  const line24Amount = parseMoney(line24)

  if (line24Amount && line24Amount > 0) {
    const payments = parseMoney(extractLineValue(lines, 33, /total\s*payments|totalpayments/i))
    const refund = parseMoney(refundOrOwed)

    if (payments && refund && payments > refund && payments - refund > line24Amount) {
      return formatMoney(payments - refund)
    }

    return line24
  }

  const payments = parseMoney(extractLineValue(lines, 33, /total\s*payments|totalpayments/i))
  const refund = parseMoney(refundOrOwed)
  if (payments && refund && payments > refund) {
    return formatMoney(payments - refund)
  }

  return null
}

export function extractFields(ocrText: string): ExtractedFields {
  if (!ocrText.trim()) return { ...EMPTY_FIELDS }

  const lines = getLines(ocrText)
  const refundOrOwed = extractRefundOrOwed(lines)

  return {
    taxpayerName: extractTaxpayerName(lines),
    filingStatus: extractFilingStatus(lines),
    totalWages: extractTotalWages(lines),
    totalTax: extractTotalTax(lines, refundOrOwed),
    refundOrOwed,
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
