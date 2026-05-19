// Grok prompt A/B harness for crypto X-handle CA discovery.
//
// Usage (PowerShell, project root):
//   node tests/grok_prompt_ab.js @senamakel
//   node tests/grok_prompt_ab.js @senamakel @somebody @another
//   node tests/grok_prompt_ab.js --variant=V2,V4 @senamakel
//
// Output:
//   tests/output/grok_prompt_ab.<handle>.json
//
// Each handle is tested against all enabled variants sequentially to avoid
// xAI rate limits. Failures in one variant don't abort the rest.

import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';

const ALL_VARIANTS = ['V1', 'V2', 'V3', 'V4', 'V5', 'V6'];
const OUTPUT_DIR = path.join(process.cwd(), 'tests', 'output');

function cleanHandle(handle) {
  return String(handle ?? '').trim().replace(/^@/, '');
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const handles = [];
  let variants = ALL_VARIANTS;
  for (const arg of args) {
    if (arg.startsWith('--variant=')) {
      variants = arg.slice('--variant='.length).split(',').map((s) => s.trim().toUpperCase());
    } else if (arg.startsWith('-')) {
      // ignore unknown flags
    } else {
      handles.push(cleanHandle(arg));
    }
  }
  return { handles: handles.filter(Boolean), variants };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postJson(url, apiKey, body, { timeoutMs = 180000, maxAttempts = 2 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 600)}`);
      }
      return JSON.parse(text);
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) await delay(1500 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

function extractText(response) {
  if (typeof response?.output_text === 'string' && response.output_text.trim()) {
    return response.output_text;
  }
  const chunks = [];
  for (const item of response?.output ?? []) {
    if (typeof item?.text === 'string') chunks.push(item.text);
    for (const content of item?.content ?? []) {
      if (typeof content?.text === 'string') chunks.push(content.text);
      if (typeof content?.output_text === 'string') chunks.push(content.output_text);
    }
  }
  return chunks.join('\n').trim();
}

function parseJsonLoose(text) {
  const cleaned = String(text ?? '')
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch (err) {
        throw new Error(`JSON parse failed: ${err.message}; head=${cleaned.slice(0, 200)}`);
      }
    }
    throw new Error(`No JSON object in model output. head=${cleaned.slice(0, 200)}`);
  }
}

function buildPrompt(variant, handle) {
  const h = cleanHandle(handle);
  const base = `
You are collecting evidence about whether the X account @${h} is associated with any crypto token.

Use X Search aggressively. Then return STRICT JSON only, no markdown fences.
`.trim();

  if (variant === 'V1') {
    // baseline — mirrors current production prompt closely (single confirmed_ca)
    return `
${base}

Find:
1. Whether @${h} has issued a token.
2. Confirmed CA / contract address. Do not invent.
3. Candidate CA if the source is not official or context is ambiguous.
4. Wallet addresses if labeled wallet, treasury, vault, team wallet, fee recipient.

Return JSON:
{
  "variant": "V1",
  "x_handle": "@${h}",
  "token_status": "string",
  "confirmed_ca": "string or empty",
  "candidate_cas": [{"address":"string","chain":"string","source":"string","confidence":"高/中/低"}],
  "wallet_addresses": [{"address":"string","label":"string","source":"string"}],
  "notes": "string",
  "evidence": [{"claim":"string","source_url":"string","quote_or_summary":"string"}]
}

Rules:
- Confirmed CA only if official X bio, pinned post, official site/docs, verified explorer, CoinGecko, or CMC labels it as token contract / CA.
- If ambiguous, use candidate_cas.
- If labeled wallet/vault/treasury, put it in wallet_addresses, NOT confirmed_ca.
`.trim();
  }

  if (variant === 'V2') {
    // launchpad-aware + multi-CA + address regex
    return `
${base}

Special focus: this account may have launched MULTIPLE tokens via launchpads. Treat
all of these as launchpad signals — extract any token address you see referenced:
- bankr.bot / @bankrbot (Base, Clanker-backed)
- clanker.world / @clanker_world / @clanker (Base, Arbitrum)
- pump.fun / *pump suffix on Solana
- Zora coins, virtuals.io, daos.fun, fjord, sunpump, four.meme, moonshot
- Generic phrases: "I launched", "deployed", "fair launch", "CA:", "ticker:"

Address regex hints:
- EVM:    0x followed by 40 hex chars
- Solana: 32-44 base58 chars, often ending with "pump", "bonk", "moon"

Return JSON (note confirmed_cas is an ARRAY — list every token clearly attributed
to @${h}):
{
  "variant": "V2",
  "x_handle": "@${h}",
  "token_status": "string",
  "confirmed_cas": [{"address":"string","chain":"Base/Solana/Ethereum/...","ticker":"string","launchpad":"bankr/clanker/pump/zora/other/unknown","source_url":"string","confidence":"高/中/低"}],
  "candidate_cas": [{"address":"string","chain":"string","source":"string","confidence":"高/中/低","reason":"why ambiguous"}],
  "wallet_addresses": [{"address":"string","label":"string"}],
  "notes": "string",
  "evidence": [{"claim":"string","source_url":"string","quote_or_summary":"string"}]
}

Rules:
- Launchpad-deployed tokens where the post author IS @${h} count as confirmed.
- For each address, state which post URL announced it.
- Multiple tokens are expected and must all be listed.
- Wallet/vault/treasury addresses go in wallet_addresses.
`.trim();
  }

  if (variant === 'V3') {
    // history sweep — explicit instruction to scan deep, relax confirmation bar
    return `
${base}

CRITICAL: Do NOT limit yourself to recent posts or bio. Scan the FULL post history
of @${h}, including replies and quote tweets, for any mention of token launches,
contract addresses, deployments, or trading links.

Specifically look at:
- The first time @${h} posts an address (often in a quote tweet or reply)
- Posts containing dexscreener.com, geckoterminal.com, basescan.io, etherscan.io,
  solscan.io, pump.fun, bankr.bot, clanker.world links
- Posts containing the strings: CA, contract, deployed, launched, ticker, $XYZ
- Posts where @${h} is replying with a token address

Confirmation bar (relaxed compared to baseline):
- A token is "self-claimed by author" if @${h} themselves announces, links, or
  promotes the token as theirs in their own post (NOT a retweet without comment).
- Self-claimed counts as confirmed_cas in this variant. Mark confidence accordingly.

Return JSON (confirmed_cas is an ARRAY):
{
  "variant": "V3",
  "x_handle": "@${h}",
  "token_status": "string",
  "confirmed_cas": [{"address":"string","chain":"string","ticker":"string","first_seen_post":"url","author_self_claimed":true,"confidence":"高/中/低"}],
  "candidate_cas": [{"address":"string","chain":"string","source":"string","confidence":"高/中/低"}],
  "wallet_addresses": [{"address":"string","label":"string"}],
  "post_count_scanned_estimate": 0,
  "earliest_token_post": "url or empty",
  "notes": "string",
  "evidence": [{"claim":"string","source_url":"string","quote_or_summary":"string"}]
}

Rules:
- Always cite the source post URL for every address.
- Multiple tokens are expected. List all of them.
`.trim();
  }

  if (variant === 'V4') {
    // expanded search surface — include bankrbot/clanker handles
    return `
${base}

You are allowed to search a WIDER surface than just @${h}. In particular, also
search posts from launchpad accounts that mention @${h}:
- @bankrbot announcements containing @${h}
- @clanker_world / @clanker deploys containing @${h}
- pump.fun / dexscreener / geckoterminal links shared by @${h} or by someone
  replying to @${h}

Cross-reference: when a launchpad account confirms a deploy attributed to @${h},
that is strong evidence even if @${h}'s own bio does not mention it.

Return JSON (confirmed_cas is an ARRAY):
{
  "variant": "V4",
  "x_handle": "@${h}",
  "token_status": "string",
  "confirmed_cas": [{"address":"string","chain":"string","ticker":"string","launchpad":"string","attribution_source":"author/launchpad/other","attribution_post":"url","confidence":"高/中/低"}],
  "candidate_cas": [{"address":"string","chain":"string","source":"string","confidence":"高/中/低"}],
  "wallet_addresses": [{"address":"string","label":"string"}],
  "notes": "string",
  "evidence": [{"claim":"string","source_url":"string","quote_or_summary":"string"}]
}

Rules:
- A launchpad attribution post + the author themselves linking to it = confirmed.
- A launchpad attribution alone = candidate.
- Always include the attribution post URL.
`.trim();
  }

  if (variant === 'V5') {
    return `
${base}

You are doing targeted CA verification. The user already supplied two possible
token contract addresses related to @${h}; your job is to verify or reject each
address using X Search evidence, not to assume they are correct.

Target addresses to verify:
- EVM/Base candidate: 0x38298138dd4389013962d8492feaa5879408dba3
- Solana/pump candidate: BBigCqRMg57zqgBQMvccvFok2Kt24uwnid47w4rWpump

Search for each exact address, shortened address fragments, @${h}, senamakel,
openhuman, pump.fun, bankr, clanker, and launch/deploy posts. Also check whether
the address appears in a reply, quote tweet, launchpad announcement, fee-recipient
thread, or community-created token that links to @${h}'s GitHub/project.

Return JSON:
{
  "variant": "V5",
  "x_handle": "@${h}",
  "target_results": [
    {"address":"string","verified_status":"confirmed/candidate/rejected/not_found","chain":"string","ticker":"string","attribution":"author_self_claim/launchpad/community/unknown","source_url":"string","quote_or_summary":"string","confidence":"high/medium/low"}
  ],
  "other_related_cas": [{"address":"string","chain":"string","ticker":"string","source_url":"string","reason":"string","confidence":"high/medium/low"}],
  "token_status": "string",
  "notes": "string",
  "evidence": [{"claim":"string","source_url":"string","quote_or_summary":"string"}]
}

Rules:
- Do not downgrade a token to "not issued" just because @${h} says they do not
  create tokens; launchpad/community tokens may still be associated.
- For each target address, explicitly say confirmed, candidate, rejected, or not_found.
- If you cannot find an exact address but find a related launch with another CA,
  put it in other_related_cas.
`.trim();
  }

  if (variant === 'V6') {
    return `
${base}

Search broadly for tokens associated with @${h} without limiting yourself to
the account's own posts. Look for:
- exact phrases: @${h}, senamakel, OpenHuman, "fee 100% to @${h}",
  "all fees will flow directly to @${h}"
- launchpads: clanker, bankrbot, pump.fun, Zora coins, virtuals, daos.fun
- EVM and Solana token addresses, including pump.fun addresses ending in pump
- posts by third parties or launchpad bots that attribute a launch, fee stream,
  ticker, or token page to @${h}

Return JSON:
{
  "variant": "V6",
  "x_handle": "@${h}",
  "token_status": "string",
  "confirmed_cas": [{"address":"string","chain":"string","ticker":"string","launchpad":"string","attribution_source":"author/launchpad/community/other","source_url":"string","confidence":"high/medium/low"}],
  "candidate_cas": [{"address":"string","chain":"string","ticker":"string","source_url":"string","reason":"string","confidence":"high/medium/low"}],
  "wallet_addresses": [{"address":"string","label":"string","source_url":"string"}],
  "notes": "string",
  "evidence": [{"claim":"string","source_url":"string","quote_or_summary":"string"}]
}

Rules:
- List multiple tokens if multiple exist.
- Launchpad attribution with explicit @${h} fee recipient or project attribution
  is enough for candidate or confirmed depending on strength.
- Separate author-created, fee-recipient-associated, and community-created tokens.
`.trim();
  }

  throw new Error(`Unknown variant: ${variant}`);
}

function searchHandlesForVariant(variant, handle) {
  const h = cleanHandle(handle);
  if (variant === 'V4') {
    return [h, 'bankrbot', 'clanker_world', 'clanker'];
  }
  if (variant === 'V5') {
    return [h, 'bankrbot', 'clanker_world', 'clanker'];
  }
  if (variant === 'V6') {
    return undefined;
  }
  return [h];
}

async function runVariant(variant, handle) {
  const start = Date.now();
  const baseUrl = config.xai.baseUrl.replace(/\/+$/, '');
  const allowed = searchHandlesForVariant(variant, handle);
  const body = {
    model: config.xai.model,
    input: [{ role: 'user', content: buildPrompt(variant, handle) }],
    tools: [
      {
        type: 'x_search',
        enable_image_understanding: true
      }
    ]
  };
  if (allowed) body.tools[0].allowed_x_handles = allowed;

  let parsed;
  let raw_text = '';
  let error = '';
  try {
    const response = await postJson(`${baseUrl}/responses`, config.xai.apiKey, body);
    raw_text = extractText(response);
    parsed = parseJsonLoose(raw_text);
  } catch (err) {
    error = err.message;
  }

  return {
    variant,
    handle: `@${cleanHandle(handle)}`,
    allowed_x_handles: allowed ?? ['<unrestricted>'],
    elapsed_ms: Date.now() - start,
    error,
    parsed,
    raw_text
  };
}

function summarizeVariant(result) {
  if (result.error) return { error: result.error };
  const p = result.parsed ?? {};
  const confirmed =
    Array.isArray(p.confirmed_cas)
      ? p.confirmed_cas.map((x) => x.address).filter(Boolean)
      : p.confirmed_ca
        ? [p.confirmed_ca]
        : [];
  const candidates = Array.isArray(p.candidate_cas)
    ? p.candidate_cas.map((x) => x.address ?? x).filter(Boolean)
    : [];
  const wallets = Array.isArray(p.wallet_addresses)
    ? p.wallet_addresses.map((x) => x.address ?? x).filter(Boolean)
    : [];
  return {
    token_status: p.token_status ?? '',
    confirmed_count: confirmed.length,
    confirmed,
    candidate_count: candidates.length,
    candidates,
    wallet_count: wallets.length,
    wallets,
    notes: p.notes ?? ''
  };
}

function printTable(handle, results) {
  console.log(`\n=== Summary for @${cleanHandle(handle)} ===`);
  for (const r of results) {
    const s = summarizeVariant(r);
    console.log(`\n[${r.variant}]  elapsed ${r.elapsed_ms}ms  search=[${r.allowed_x_handles.join(',')}]`);
    if (s.error) {
      console.log(`  ERROR: ${s.error}`);
      continue;
    }
    console.log(`  token_status   : ${s.token_status}`);
    console.log(`  confirmed (${s.confirmed_count}): ${s.confirmed.join(' | ') || '-'}`);
    console.log(`  candidate (${s.candidate_count}): ${s.candidates.join(' | ') || '-'}`);
    console.log(`  wallets   (${s.wallet_count}): ${s.wallets.join(' | ') || '-'}`);
    if (s.notes) console.log(`  notes          : ${s.notes.slice(0, 200)}`);
  }
}

async function main() {
  const { handles, variants } = parseArgs(process.argv);
  if (!handles.length) {
    console.error('Usage: node tests/grok_prompt_ab.js [--variant=V1,V2,V3,V4] @handle [@handle ...]');
    process.exit(1);
  }
  if (!config.xai.apiKey) {
    console.error('XAI_API_KEY missing in .env');
    process.exit(1);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  console.log(`Model: ${config.xai.model}`);
  console.log(`Handles: ${handles.map((h) => '@' + h).join(', ')}`);
  console.log(`Variants: ${variants.join(', ')}\n`);

  for (const handle of handles) {
    const results = [];
    for (const variant of variants) {
      process.stdout.write(`> ${variant} @${handle} ... `);
      const r = await runVariant(variant, handle);
      console.log(r.error ? `FAIL (${r.error.slice(0, 80)})` : `ok (${r.elapsed_ms}ms)`);
      results.push(r);
      await delay(1200); // gentle pacing
    }
    const out = {
      handle: `@${handle}`,
      model: config.xai.model,
      generated_at: new Date().toISOString(),
      results
    };
    const outPath = path.join(OUTPUT_DIR, `grok_prompt_ab.${handle}.json`);
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
    printTable(handle, results);
    console.log(`\nSaved: ${outPath}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
