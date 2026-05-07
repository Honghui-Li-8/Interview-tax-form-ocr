import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import Tesseract from 'tesseract.js'

const isDevObservabilityEnabled = (): boolean =>
  process.env.NODE_ENV !== 'production' && process.env.DEBUG === 'true'

function logOcr(message: string): void {
  if (isDevObservabilityEnabled()) {
    console.log(`[ocr] ${message}`)
  }
}

async function recognizeImage(imagePath: string): Promise<string> {
  const { data: { text } } = await Tesseract.recognize(imagePath, 'eng')
  return text
}

async function runPdfOcr(filePath: string): Promise<string> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tax-ocr-'))
  const startedAt = Date.now()

  logOcr(`created temp render directory ${tmpDir}`)

  try {
    const outputPrefix = path.join(tmpDir, 'page')
    const renderStartedAt = Date.now()

    logOcr(`rendering PDF ${filePath} at 200 DPI`)
    execFileSync('pdftoppm', ['-r', '200', '-png', filePath, outputPrefix], { stdio: 'pipe' })
    logOcr(`rendered PDF in ${Date.now() - renderStartedAt}ms`)

    const pageImages = fs.readdirSync(tmpDir)
      .filter((file) => file.endsWith('.png'))
      .sort()

    logOcr(`found ${pageImages.length} rendered page image(s)`)

    if (pageImages.length === 0) {
      throw new Error('No page images were rendered from PDF')
    }

    const pageTexts: string[] = []
    for (const [index, image] of pageImages.entries()) {
      const pageStartedAt = Date.now()
      const pageText = await recognizeImage(path.join(tmpDir, image))
      pageTexts.push(pageText)
      logOcr(`recognized page ${index + 1}/${pageImages.length} in ${Date.now() - pageStartedAt}ms (${pageText.length} chars)`)
    }

    logOcr(`completed OCR in ${Date.now() - startedAt}ms (${pageTexts.join('\n').length} chars total)`)
    return pageTexts.join('\n')
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    logOcr(`removed temp render directory ${tmpDir}`)
  }
}

export async function runOcr(filePath: string): Promise<string> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`OCR input file does not exist: ${filePath}`)
  }

  const ext = path.extname(filePath).toLowerCase()
  if (ext !== '.pdf') {
    throw new Error(`Unsupported OCR file type: ${ext || 'unknown'}`)
  }

  return runPdfOcr(filePath)
}
