import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

export type RenderedPage = {
  pageNumber: number
  imagePath: string
  mimeType: 'image/png'
}

const RENDER_DPI = '200'

const isDevObservabilityEnabled = (): boolean =>
  process.env.NODE_ENV !== 'production' && process.env.DEBUG === 'true'

function logRender(message: string): void {
  if (isDevObservabilityEnabled()) {
    console.log(`[page-render] ${message}`)
  }
}

function renderedPageNumber(fileName: string): number {
  const match = fileName.match(/-(\d+)\.png$/)
  return match ? Number.parseInt(match[1], 10) : Number.NaN
}

function listRenderedPages(tmpDir: string): RenderedPage[] {
  return fs.readdirSync(tmpDir)
    .filter(file => file.endsWith('.png'))
    .map(file => ({
      file,
      pageNumber: renderedPageNumber(file),
    }))
    .filter(page => Number.isFinite(page.pageNumber))
    .sort((a, b) => a.pageNumber - b.pageNumber)
    .map(page => ({
      pageNumber: page.pageNumber,
      imagePath: path.join(tmpDir, page.file),
      mimeType: 'image/png' as const,
    }))
}

export async function withRenderedPdfPages<T>(
  filePath: string,
  callback: (pages: RenderedPage[]) => Promise<T>
): Promise<T> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`PDF input file does not exist: ${filePath}`)
  }

  const ext = path.extname(filePath).toLowerCase()
  if (ext !== '.pdf') {
    throw new Error(`Unsupported PDF file type: ${ext || 'unknown'}`)
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tax-render-'))
  logRender(`created temp render directory ${tmpDir}`)

  try {
    const outputPrefix = path.join(tmpDir, 'page')
    const renderStartedAt = Date.now()

    logRender(`rendering PDF ${filePath} at ${RENDER_DPI} DPI`)
    execFileSync('pdftoppm', ['-r', RENDER_DPI, '-png', filePath, outputPrefix], { stdio: 'pipe' })
    logRender(`rendered PDF in ${Date.now() - renderStartedAt}ms`)

    const pages = listRenderedPages(tmpDir)
    logRender(`found ${pages.length} rendered page image(s)`)

    if (pages.length === 0) {
      throw new Error('No page images were rendered from PDF')
    }

    return await callback(pages)
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    logRender(`removed temp render directory ${tmpDir}`)
  }
}
