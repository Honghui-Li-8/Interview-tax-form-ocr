import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { execFileSync } = vi.hoisted(() => ({
  execFileSync: vi.fn(),
}))

vi.mock('child_process', () => ({
  execFileSync,
}))

import { withRenderedPdfPages } from './pageRenderService'

let fixtureDir: string
let pdfPath: string

beforeEach(() => {
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'page-render-test-'))
  pdfPath = path.join(fixtureDir, 'return.pdf')
  fs.writeFileSync(pdfPath, 'fake pdf')
  execFileSync.mockReset()
})

afterEach(() => {
  fs.rmSync(fixtureDir, { recursive: true, force: true })
})

describe('withRenderedPdfPages', () => {
  it('renders PDF pages in numeric page order and cleans temporary files', async () => {
    let tempImageDir = ''

    execFileSync.mockImplementation((_cmd, args: string[]) => {
      const outputPrefix = args[args.length - 1]
      tempImageDir = path.dirname(outputPrefix)
      fs.writeFileSync(`${outputPrefix}-10.png`, 'ten')
      fs.writeFileSync(`${outputPrefix}-2.png`, 'two')
      fs.writeFileSync(`${outputPrefix}-1.png`, 'one')
    })

    const result = await withRenderedPdfPages(pdfPath, async pages => {
      expect(pages.map(page => page.pageNumber)).toEqual([1, 2, 10])
      expect(pages.every(page => page.mimeType === 'image/png')).toBe(true)
      expect(pages.every(page => fs.existsSync(page.imagePath))).toBe(true)
      return pages.map(page => path.basename(page.imagePath))
    })

    expect(result).toEqual(['page-1.png', 'page-2.png', 'page-10.png'])
    expect(fs.existsSync(tempImageDir)).toBe(false)
  })

  it('rejects non-PDF inputs before rendering', async () => {
    const textPath = path.join(fixtureDir, 'return.txt')
    fs.writeFileSync(textPath, 'not pdf')

    await expect(withRenderedPdfPages(textPath, async () => undefined))
      .rejects.toThrow('Unsupported PDF file type')
    expect(execFileSync).not.toHaveBeenCalled()
  })

  it('rejects missing files before rendering', async () => {
    await expect(withRenderedPdfPages(path.join(fixtureDir, 'missing.pdf'), async () => undefined))
      .rejects.toThrow('PDF input file does not exist')
    expect(execFileSync).not.toHaveBeenCalled()
  })

  it('rejects PDFs that render no pages and still cleans up', async () => {
    let tempImageDir = ''

    execFileSync.mockImplementation((_cmd, args: string[]) => {
      tempImageDir = path.dirname(args[args.length - 1])
    })

    await expect(withRenderedPdfPages(pdfPath, async () => undefined))
      .rejects.toThrow('No page images were rendered from PDF')
    expect(fs.existsSync(tempImageDir)).toBe(false)
  })
})
