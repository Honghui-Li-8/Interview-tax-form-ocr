export type DocumentParserMode = 'claude'

export type ParserConfig = {
  parser: DocumentParserMode
  anthropicApiKey: string | null
  claudeModel: string
  maxFormPagesPerCall: number
}

const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-5'
const DEFAULT_MAX_FORM_PAGES_PER_CALL = 4

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function getParserConfig(env: NodeJS.ProcessEnv = process.env): ParserConfig {
  return {
    parser: 'claude',
    anthropicApiKey: env.ANTHROPIC_API_KEY?.trim() || null,
    claudeModel: env.CLAUDE_MODEL?.trim() || DEFAULT_CLAUDE_MODEL,
    maxFormPagesPerCall: parsePositiveInteger(
      env.CLAUDE_MAX_FORM_PAGES_PER_CALL,
      DEFAULT_MAX_FORM_PAGES_PER_CALL
    ),
  }
}

export function hasClaudeApiKey(config: ParserConfig = getParserConfig()): boolean {
  return Boolean(config.anthropicApiKey)
}
