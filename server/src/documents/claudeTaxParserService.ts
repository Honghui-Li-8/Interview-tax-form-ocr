import fs from 'fs'
import Anthropic from '@anthropic-ai/sdk'
import type {
  PageClassification,
  ParsedTaxForm,
  SupportedTaxFormType,
  TaxReturnExtraction,
} from '../../../shared/types'
import { getParserConfig, type ParserConfig } from './parserConfig'
import { withRenderedPdfPages, type RenderedPage } from './pageRenderService'
import { normalizeParsedForm } from './extractionNormalizationService'
import { validatePageClassifications, validateParsedForm } from './extractionValidationService'
import { groupPagesByForm, mergeParsedForms } from './taxPacketMergeService'
import { reconcileTaxReturnExtraction } from './reconciliationService'
import {
  getClaudeFieldSchema,
  getDefaultSchema,
  SUPPORTED_FORM_TYPES,
  type TaxFormSchema,
} from './taxFormSchemas'

type ClaudeClient = {
  messages: {
    create(input: unknown): Promise<unknown>
  }
}

type ParserOptions = {
  config?: ParserConfig
  client?: ClaudeClient
}

function ensureClaudeClient(options: ParserOptions = {}): { config: ParserConfig; client: ClaudeClient } {
  const config = options.config ?? getParserConfig()
  if (!config.anthropicApiKey) {
    throw new Error('ANTHROPIC_API_KEY is required for Claude document parsing')
  }

  return {
    config,
    client: options.client ?? new Anthropic({ apiKey: config.anthropicApiKey }),
  }
}

function imageContent(page: RenderedPage): Record<string, unknown> {
  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: page.mimeType,
      data: fs.readFileSync(page.imagePath).toString('base64'),
    },
  }
}

function textContent(text: string): Record<string, unknown> {
  return { type: 'text', text }
}

function extractTextFromClaudeResponse(response: unknown): string {
  const content = (response as { content?: Array<{ type?: string; text?: string }> }).content
  const text = content?.find(part => part.type === 'text' && typeof part.text === 'string')?.text
  if (!text) throw new Error('Claude response did not include text content')
  return text
}

function parseClaudeJson(response: unknown): unknown {
  const text = extractTextFromClaudeResponse(response).trim()
  const withoutFence = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .replace(/^json\s+/i, '')
    .trim()

  try {
    return JSON.parse(withoutFence)
  } catch {
    const jsonStart = withoutFence.search(/[\[{]/)
    if (jsonStart < 0) throw new Error('Claude response did not contain JSON')
    return JSON.parse(withoutFence.slice(jsonStart))
  }
}

async function createClaudeJson(
  client: ClaudeClient,
  config: ParserConfig,
  content: Record<string, unknown>[]
): Promise<unknown> {
  const response = await client.messages.create({
    model: config.claudeModel,
    max_tokens: 8192,
    messages: [{ role: 'user', content }],
  })
  return parseClaudeJson(response)
}

function classificationPrompt(): string {
  return [
    'Classify each page image as exactly one supported federal tax form or Unknown.',
    `Supported forms: ${SUPPORTED_FORM_TYPES.join(', ')}.`,
    'Return JSON only, no Markdown.',
    'Shape: [{"pageNumber":1,"formType":"1040","taxYear":"2025","pageRole":"page 1","confidence":"high"}].',
    'Use only confidence values high, medium, low, unknown.',
  ].join('\n')
}

function extractionPrompt(formType: SupportedTaxFormType, schema: TaxFormSchema, pageNumbers: number[]): string {
  const pageList = pageNumbers.join(', ')
  return [
    `Extract ${formType} from the provided page image(s).`,
    'Return JSON only, no Markdown.',
    `The images correspond to PDF page numbers: ${pageList}.`,
    `Response shape: {"formType":"${formType}","present":true,"taxYear":"${schema.taxYear}","sourcePages":[${pageList}],"fields":{<key>:{"value":<value>,"confidence":"high"|"medium"|"low"|"unknown","sourcePage":<one of: ${pageList}>,"rawText":<string>},...}}`,
    'Use schema keys exactly. Do not use labels as output keys.',
    'Every schema key must appear exactly once under fields.',
    'Prefer null for blank, unreadable, or not-present values.',
    'All field values must be strings, null, or booleans — never numbers.',
    'Do not infer values from tax formulas when the printed field is blank.',
    `Field schema: ${JSON.stringify(getClaudeFieldSchema(formType, schema.taxYear))}`,
  ].join('\n')
}

export async function classifyTaxPages(
  pages: RenderedPage[],
  options: ParserOptions = {}
): Promise<PageClassification[]> {
  if (pages.length === 0) throw new Error('Cannot classify an empty page list')
  for (const page of pages) {
    if (!fs.existsSync(page.imagePath)) throw new Error(`Rendered page image does not exist: ${page.imagePath}`)
  }

  const { config, client } = ensureClaudeClient(options)
  const json = await createClaudeJson(client, config, [
    textContent(classificationPrompt()),
    ...pages.map(imageContent),
  ])
  return validatePageClassifications(json, pages)
}

function chunkPages(pages: RenderedPage[], maxPages: number): RenderedPage[][] {
  const chunks: RenderedPage[][] = []
  for (let index = 0; index < pages.length; index += maxPages) {
    chunks.push(pages.slice(index, index + maxPages))
  }
  return chunks
}

function mergeParsedFormChunks(formType: SupportedTaxFormType, forms: ParsedTaxForm[]): ParsedTaxForm {
  const [first, ...rest] = forms
  if (!first) throw new Error(`No parsed chunks returned for ${formType}`)

  const merged: ParsedTaxForm = {
    ...first,
    sourcePages: [...new Set(forms.flatMap(form => form.sourcePages))].sort((a, b) => a - b),
    fields: { ...first.fields },
  }

  for (const form of rest) {
    for (const [key, field] of Object.entries(form.fields)) {
      const existing = merged.fields[key]
      if (!existing || existing.value === null) {
        merged.fields[key] = field
      }
    }
  }

  return merged
}

export async function parseFormGroup(
  formType: SupportedTaxFormType,
  pages: RenderedPage[],
  schema: TaxFormSchema = getDefaultSchema(formType),
  options: ParserOptions = {}
): Promise<ParsedTaxForm> {
  if (pages.length === 0) throw new Error(`Cannot parse ${formType} without pages`)
  const { config, client } = ensureClaudeClient(options)
  const chunks = chunkPages(pages, config.maxFormPagesPerCall)

  const parsedChunks: ParsedTaxForm[] = []
  for (const chunk of chunks) {
    const json = await createClaudeJson(client, config, [
      textContent(extractionPrompt(formType, schema, chunk.map(page => page.pageNumber))),
      ...chunk.map(imageContent),
    ])
    const validated = validateParsedForm(formType, json, schema, chunk.map(page => page.pageNumber))
    parsedChunks.push(normalizeParsedForm(validated, schema))
  }

  return mergeParsedFormChunks(formType, parsedChunks)
}

export async function parseTaxReturnPacket(
  filePath: string,
  options: ParserOptions = {}
): Promise<TaxReturnExtraction> {
  ensureClaudeClient(options)

  return withRenderedPdfPages(filePath, async pages => {
    const classifications = await classifyTaxPages(pages, options)
    const groupedPages = groupPagesByForm(classifications, pages)
    const parsedForms: Partial<Record<SupportedTaxFormType, ParsedTaxForm>> = {}

    for (const formType of SUPPORTED_FORM_TYPES) {
      const formPages = groupedPages.get(formType)
      if (!formPages || formPages.length === 0) continue
      parsedForms[formType] = await parseFormGroup(formType, formPages, getDefaultSchema(formType), options)
    }

    return reconcileTaxReturnExtraction(mergeParsedForms(classifications, parsedForms))
  })
}
