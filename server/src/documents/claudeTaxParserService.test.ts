import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ParsedTaxForm } from '../../../shared/types'
import { parseFormGroup, classifyTaxPages } from './claudeTaxParserService'
import { createEmptyParsedForm } from './extractionValidationService'
import type { RenderedPage } from './pageRenderService'
import { getDefaultSchema } from './taxFormSchemas'

type MockClaudeClient = {
  messages: {
    create: ReturnType<typeof vi.fn>
  }
}

let tempDir: string
let pages: RenderedPage[]
let client: MockClaudeClient

const config = {
  parser: 'claude' as const,
  anthropicApiKey: 'test-key',
  claudeModel: 'test-model',
  maxFormPagesPerCall: 4,
}

function claudeText(value: unknown): unknown {
  return {
    content: [{ type: 'text', text: JSON.stringify(value) }],
  }
}

function emptyForm(formType: '1040' | 'Schedule A', sourcePages = [1]): ParsedTaxForm {
  const schema = getDefaultSchema(formType)
  return {
    ...createEmptyParsedForm(formType, schema),
    present: true,
    sourcePages,
  }
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-parser-test-'))
  const imagePath = path.join(tempDir, 'page-1.png')
  fs.writeFileSync(imagePath, 'image bytes')
  pages = [{ pageNumber: 1, imagePath, mimeType: 'image/png' }]
  client = { messages: { create: vi.fn() } }
})

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

describe('claudeTaxParserService', () => {
  it('classifies pages through Claude and validates the response', async () => {
    client.messages.create.mockResolvedValueOnce(claudeText([
      { pageNumber: 1, formType: '1040', taxYear: '2025', pageRole: 'page 1', confidence: 'high' },
    ]))

    const classifications = await classifyTaxPages(pages, { config, client })

    expect(classifications).toEqual([
      { pageNumber: 1, formType: '1040', taxYear: '2025', pageRole: 'page 1', confidence: 'high' },
    ])
    expect(client.messages.create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'test-model',
    }))
  })

  it('fails cleanly when the Claude API key is missing', async () => {
    await expect(classifyTaxPages(pages, {
      config: { ...config, anthropicApiKey: null },
      client,
    })).rejects.toThrow('ANTHROPIC_API_KEY is required')
  })

  it('rejects malformed Claude JSON', async () => {
    client.messages.create.mockResolvedValueOnce({ content: [{ type: 'text', text: '{not json' }] })

    await expect(classifyTaxPages(pages, { config, client })).rejects.toThrow()
  })

  it('parses a form group with only the selected form schema in the prompt', async () => {
    const form = emptyForm('Schedule A')
    form.fields.line17.value = '$10,000'
    client.messages.create.mockResolvedValueOnce(claudeText(form))

    const parsed = await parseFormGroup('Schedule A', pages, getDefaultSchema('Schedule A'), { config, client })
    const createInput = client.messages.create.mock.calls[0][0] as {
      messages: Array<{ content: Array<{ type: string; text?: string }> }>
    }
    const prompt = createInput.messages[0].content.find(part => part.type === 'text')?.text ?? ''

    expect(parsed.fields.line17.value).toBe('10000')
    expect(prompt).toContain('Schedule A')
    expect(prompt).toContain('"line17"')
    expect(prompt).not.toContain('"line1InterestPayers"')
  })

  it('batches oversized form groups deterministically', async () => {
    const secondImage = path.join(tempDir, 'page-2.png')
    const thirdImage = path.join(tempDir, 'page-3.png')
    fs.writeFileSync(secondImage, 'image bytes')
    fs.writeFileSync(thirdImage, 'image bytes')
    const batchedPages: RenderedPage[] = [
      pages[0],
      { pageNumber: 2, imagePath: secondImage, mimeType: 'image/png' },
      { pageNumber: 3, imagePath: thirdImage, mimeType: 'image/png' },
    ]
    client.messages.create
      .mockResolvedValueOnce(claudeText(emptyForm('1040', [1, 2])))
      .mockResolvedValueOnce(claudeText(emptyForm('1040', [3])))

    const parsed = await parseFormGroup('1040', batchedPages, getDefaultSchema('1040'), {
      config: { ...config, maxFormPagesPerCall: 2 },
      client,
    })

    expect(client.messages.create).toHaveBeenCalledTimes(2)
    expect(parsed.sourcePages).toEqual([1, 2, 3])
  })
})
