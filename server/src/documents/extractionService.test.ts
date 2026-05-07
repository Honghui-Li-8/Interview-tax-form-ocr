import { describe, test, expect } from 'vitest'
import { extractFields, getDemoFields } from './extractionService'

const SAMPLE_OCR = `
Your first name and initial
Jane A. Smith 123456789

If joint return, spouse's first name and middle initial
Alex Smith 987654321

Filing status
Single

9 Add lines 1, 2b, 3b, 4b, 5b, 6b, 7, and 8. This is your total income 72,500

24 Add lines 22 and 23. This is your total tax [24] 8,342

33 Add lines 25d, 26, and 32. These are your total payments [33] 9,546
Refund 34 This is the amount you overpaid [34] 1,204
`

const SAMPLE_1_REAL_OCR = `
Filing Status ] single Married filing jointly ~ [[] Married filing separately (MFS) [] Head of household (HOH) ] Qualifying widow(er) (QW)
Your first name and middle initial Last name Your social security number
Robin Brook 222222222
If joint return, spouse's first name and middle initial Last name Spouse's social security number
Sam Brook 333333333
1 Wages, salaries, tips, etc. Attach Form(s) W-2 e e 42,000
9 Add lines 1, 2b, 3b, 4b, 5b, 6b, 7, and 8. This is your total income S, n 42,000
24 Addlines22and 23. Thisisyourtotaltax . . . . . . . . . . . . . . . . » [24]
Refund 34 Ifline 33 is more than line 24, subtract line 24 from line 33. This is the amount you overpaid . . m
Amount 37 Amount you owe. Subtract line 33 from line 24. For details on how to pay, see instructions . >
`

const SAMPLE_2_REAL_OCR = `
Directions: Use the information from the W2 to complete the 1040 for Billie Does.
Filing Status [ Single [] Married fiing jointy [] Married fiing separately (MFS) [] Haad of household (HOH) [] Qualifying widowier) [OW)
Billie J. Does 123laslers8e
b rsa 9  Addiines 1,2b,3b, &b, 5b,6b,7,and 8. Thissyourtotalincome . . . . . . . . . » [ 9| 39,027
24 Addines22and23. Thisisyourtotaltax . . . . . . . . . . . . . . . . » |[24] 978
33 Add ines 25d, 26, and 32. These areyourtotalpayments . . . . . . . . . . . » | 33| 3,125
Refund 34 [fine33ismore than line 24, subtract line 24 from ine 33. This is the amount you overpaid . . | 34 | 147
Amount 37  Amount you owe. Subtract line 33 from line 24. For details on how to pay, see instructions . B | 37 | 0
`

describe('extractFields', () => {
  test('parses all 5 fields from sample OCR text', () => {
    const fields = extractFields(SAMPLE_OCR)
    expect(fields.taxpayerName).toBe('Jane A. Smith')
    expect(fields.filingStatus).toBe('Married filing jointly')
    expect(fields.totalWages).toBe('72,500')
    expect(fields.totalTax).toBe('8,342')
    expect(fields.refundOrOwed).toBe('1,204')
  })

  test('parses sample 1 real OCR fields and leaves blank tax/refund values null', () => {
    const fields = extractFields(SAMPLE_1_REAL_OCR)
    expect(fields.taxpayerName).toBe('Robin Brook')
    expect(fields.filingStatus).toBe('Married filing jointly')
    expect(fields.totalWages).toBe('42,000')
    expect(fields.totalTax).toBeNull()
    expect(fields.refundOrOwed).toBeNull()
  })

  test('parses sample 2 real OCR fields, including derived total tax', () => {
    const fields = extractFields(SAMPLE_2_REAL_OCR)
    expect(fields.taxpayerName).toBe('Billie J. Does')
    expect(fields.filingStatus).toBe('Single')
    expect(fields.totalWages).toBe('39,027')
    expect(fields.totalTax).toBe('2,978')
    expect(fields.refundOrOwed).toBe('147')
  })

  test('returns all null for empty input', () => {
    const fields = extractFields('')
    expect(Object.values(fields).every(v => v === null)).toBe(true)
  })
})

describe('getDemoFields', () => {
  test('returns all five fields as non-null strings', () => {
    const fields = getDemoFields()
    expect(Object.values(fields).every(v => typeof v === 'string' && v.length > 0)).toBe(true)
  })
})
