import fs from 'node:fs';
import path from 'node:path';

function loadDotEnv() {
  const file = path.join(process.cwd(), '.env');
  if (!fs.existsSync(file)) return;

  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, '');
  }
}

function readInt(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) ? value : fallback;
}

function readBool(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

loadDotEnv();

export const config = {
  port: readInt('PORT', 3000),
  maxBatchSize: readInt('MAX_BATCH_SIZE', 20),
  concurrency: Math.max(1, Math.min(5, readInt('ANALYSIS_CONCURRENCY', 3))),
  mockLLM: process.argv.includes('--mock') || readBool('MOCK_LLM', false),
  xai: {
    apiKey: process.env.XAI_API_KEY ?? '',
    baseUrl: process.env.XAI_BASE_URL ?? 'https://api.x.ai/v1',
    model: process.env.XAI_MODEL ?? 'grok-4.3'
  },
  gpt: {
    apiKey:
      process.env.GPT_API_KEY ??
      process.env.UNIVERSAL_API_KEY ??
      process.env.OPENAI_API_KEY ??
      '',
    baseUrl:
      process.env.GPT_BASE_URL ??
      process.env.UNIVERSAL_BASE_URL ??
      'https://api.apikey.fun/v1',
    model:
      process.env.GPT_MODEL ??
      process.env.UNIVERSAL_MODEL ??
      'gpt-5.5'
  },
  claude: {
    apiKey: process.env.CLAUDE_API_KEY ?? '',
    baseUrl:
      process.env.CLAUDE_BASE_URL ??
      process.env.UNIVERSAL_BASE_URL ??
      'https://api.anthropic.com/v1',
    model: process.env.CLAUDE_MODEL ?? 'claude-4.5-sonnet'
  }
};

export function publicConfig() {
  return {
    maxBatchSize: config.maxBatchSize,
    concurrency: config.concurrency,
    mockLLM: config.mockLLM,
    xaiModel: config.xai.model,
    gptModel: config.gpt.model,
    claudeModel: config.claude.model,
    hasClaude: Boolean(config.claude.apiKey)
  };
}
