import Tesseract from 'tesseract.js'
import { withRenderedPdfPages } from './pageRenderService'

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

export async function runOcr(filePath: string): Promise<string> {
  const startedAt = Date.now()

  return withRenderedPdfPages(filePath, async pages => {
    const pageTexts: string[] = []
    for (const page of pages) {
      const pageStartedAt = Date.now()
      const pageText = await recognizeImage(page.imagePath)
      pageTexts.push(pageText)
      logOcr(`recognized page ${page.pageNumber}/${pages.length} in ${Date.now() - pageStartedAt}ms (${pageText.length} chars)`)
    }

    logOcr(`completed OCR in ${Date.now() - startedAt}ms (${pageTexts.join('\n').length} chars total)`)
    return pageTexts.join('\n')
  })
}
