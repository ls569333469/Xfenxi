import { config } from './config.js';

const TOKEN_STATUSES = [
  '已发币，CA已确认',
  '已发币，但CA存疑',
  '确认将发币，未TGE',
  '强烈暗示发币',
  '弱暗示发币',
  '暂无发币迹象',
  '明确表示不发币',
  '信息冲突，需人工确认'
];

const TGE_STATUSES = [
  '已TGE',
  '明确TGE日期',
  '明确月份/季度',
  '路线图推断',
  '社区传闻/弱暗示',
  '暂无可靠信息'
];

function cleanHandle(handle) {
  return String(handle ?? '').trim().replace(/^@/, '');
}

async function postJson(url, apiKey, body, options = {}) {
  const maxAttempts = options.maxAttempts ?? 3;
  const timeoutMs = options.timeoutMs ?? 90000;
  let response;
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    ...(options.headers ?? {})
  };
  for (const key of Object.keys(headers)) {
    if (headers[key] === undefined || headers[key] === null) delete headers[key];
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal
      });
      break;
    } catch (error) {
      if (attempt === maxAttempts) throw error;
      await delay(800 * attempt);
    } finally {
      clearTimeout(timeout);
    }
  }

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}: ${text.slice(0, 800)}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON response from ${url}: ${text.slice(0, 800)}`);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractResponsesText(response) {
  if (typeof response?.output_text === 'string') return response.output_text;
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

function extractChatText(response) {
  const content = response?.choices?.[0]?.message?.content;
  if (Array.isArray(content)) {
    return content
      .map((part) => part.text ?? part.content ?? '')
      .filter(Boolean)
      .join('\n');
  }
  return String(content ?? '').trim();
}

function parseJsonFromText(text) {
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
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error(`Model did not return parseable JSON: ${cleaned.slice(0, 500)}`);
  }
}

function collectCitations(response) {
  const citations = response?.citations ?? response?.sources ?? [];
  if (!Array.isArray(citations)) return [];
  return citations
    .map((item) => {
      if (typeof item === 'string') return { url: item };
      return {
        url: item.url ?? item.uri ?? item.source_url ?? '',
        title: item.title ?? item.name ?? ''
      };
    })
    .filter((item) => item.url);
}

function normalizeCaEntry(entry) {
  if (!entry) return null;
  if (typeof entry === 'string') {
    const address = entry.trim();
    return address ? { address } : null;
  }
  if (typeof entry === 'object') {
    const address = String(entry.address ?? entry.ca ?? entry.contract ?? '').trim();
    return address ? { ...entry, address } : null;
  }
  return null;
}

function normalizeCaList(value) {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.map(normalizeCaEntry).filter(Boolean);
}

function primaryCaFrom(result) {
  return normalizeCaList(result?.confirmed_cas)[0]?.address || String(result?.confirmed_ca ?? '').trim();
}

function normalizeGrokResult(result) {
  const confirmed_cas = normalizeCaList(result?.confirmed_cas);
  const legacyCa = String(result?.confirmed_ca ?? '').trim();
  if (!confirmed_cas.length && legacyCa) {
    confirmed_cas.push({
      address: legacyCa,
      chain: '',
      source_url: '',
      confidence: result?.ca_confidence || ''
    });
  }
  return {
    ...result,
    confirmed_ca: confirmed_cas[0]?.address || legacyCa,
    confirmed_cas,
    candidate_cas: normalizeCaList(result?.candidate_cas),
    wallet_addresses: normalizeCaList(result?.wallet_addresses)
  };
}

function caKey(address) {
  return String(address ?? '').trim().toLowerCase();
}

function uniqueCaList(items) {
  const seen = new Set();
  const list = [];
  for (const item of normalizeCaList(items)) {
    const key = caKey(item.address);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    list.push(item);
  }
  return list;
}

function mergeVerifiedCas(result, verification) {
  const confirmed = uniqueCaList(result.confirmed_cas);
  const confirmedKeys = new Set(confirmed.map((item) => caKey(item.address)));
  const verifiedConfirmed = [
    ...(verification?.confirmed_cas ?? []),
    ...(verification?.target_results ?? []).filter((item) => item.verified_status === 'confirmed')
  ];

  for (const item of normalizeCaList(verifiedConfirmed)) {
    const key = caKey(item.address);
    if (!key || confirmedKeys.has(key)) continue;
    confirmed.push(item);
    confirmedKeys.add(key);
  }

  const candidate_cas = uniqueCaList([
    ...(result.candidate_cas ?? []),
    ...(verification?.candidate_cas ?? [])
  ]).filter((item) => !confirmedKeys.has(caKey(item.address)));

  return {
    ...result,
    confirmed_ca: confirmed[0]?.address || result.confirmed_ca || '',
    confirmed_cas: confirmed,
    candidate_cas,
    evidence: [...(result.evidence ?? []), ...(verification?.evidence ?? [])],
    notes: [result.notes, verification?.notes].filter(Boolean).join('\n')
  };
}

function shouldVerifyCandidateCas(result) {
  return normalizeCaList(result.candidate_cas).some((item) => item.address && item.address.length >= 32);
}

function shouldSearchAssociatedCas(result) {
  if (primaryCaFrom(result) || normalizeCaList(result?.candidate_cas).length) return false;
  const evidenceText = [
    result?.token_status,
    result?.notes,
    result?.risk_flags,
    result?.recent_developments,
    result?.raw_text,
    ...(Array.isArray(result?.evidence)
      ? result.evidence.map((item) => [item.claim, item.quote_or_summary].filter(Boolean).join(' '))
      : [])
  ].filter(Boolean).join('\n').toLowerCase();

  return [
    'claim fees',
    'claim the fees',
    'fee recipient',
    'reward owner',
    'reward ownership',
    'pump.fun',
    'pumpfun',
    'community token',
    'bankr',
    'bankrbot',
    'clanker'
  ].some((signal) => evidenceText.includes(signal));
}

async function searchAssociatedCasWithGrok({ handle, project, result, baseUrl }) {
  const prompt = `
You are doing a second-pass search for associated community or launchpad token CAs.

The first pass found no CA, but it found fee/community-token style evidence. Do not
stop at "the account says they do not create tokens". Search whether there are
community-created, launchpad-created, fee-recipient, reward-owner, or project-linked
tokens associated with the account/project.

Project input:
- X handle: @${handle}
- Project name: ${project.project_name || result?.project_name || 'unknown'}
- Website: ${project.website || 'unknown'}
- Chain: ${project.chain || 'unknown'}
- Notes: ${project.notes || 'none'}

First-pass signals:
- Token status: ${Array.isArray(result?.token_status) ? result.token_status.join('; ') : result?.token_status || 'unknown'}
- Notes: ${result?.notes || 'none'}
- Evidence summaries:
${Array.isArray(result?.evidence) ? result.evidence.map((item) => `  - ${item.claim || ''} ${item.quote_or_summary || ''} ${item.source_url || ''}`.trim()).join('\n') : '  - none'}

Search strategy:
- Search @${handle}, ${handle}, project name, ticker-like names, and profile-linked project names.
- Search exact phrases: "claim fees", "claim the fees", "fee 100% to", "fees will flow to",
  "reward owner", "reward ownership", "community token", "CA", "contract", "launched", "deployed".
- Search launchpad and bot posts from bankrbot, Bankr, Clanker, clanker_world, pump.fun,
  Zora coins, Virtuals, daos.fun, fjord, sunpump, four.meme, and moonshot.
- Search replies and quote tweets where third parties mention @${handle} with a token address.

Return STRICT JSON only:
{
  "confirmed_cas": [{"address":"string","chain":"string","ticker":"string","launchpad":"bankr/clanker/pump/zora/other/unknown","attribution_source":"author/launchpad/community/fee-recipient/other","source_url":"string","confidence":"high/medium/low"}],
  "candidate_cas": [{"address":"string","chain":"string","ticker":"string","source_url":"string","reason":"string","confidence":"high/medium/low"}],
  "evidence": [{"claim":"string","source_url":"string","quote_or_summary":"string","confidence":"high/medium/low"}],
  "notes": "string"
}

Rules:
- If @${handle} posts a token address as a community token supporting the project, put it in confirmed_cas.
- If a launchpad/bot post attributes a token, fee stream, reward owner, or deploy to @${handle} or the project, put the exact full token address in confirmed_cas.
- If the address is truncated, the attribution is only rumor, or the role is unclear, put it in candidate_cas.
- Preserve attribution. A community or fee-recipient token can be confirmed associated even when it is not author-created or official.
- If no reliable address is found, return empty arrays and explain what you searched.
`.trim();

  const response = await postJson(`${baseUrl}/responses`, config.xai.apiKey, {
    model: config.xai.model,
    input: [{ role: 'user', content: prompt }],
    tools: [
      {
        type: 'x_search',
        enable_image_understanding: true
      }
    ]
  });
  return normalizeGrokResult(parseJsonFromText(extractResponsesText(response)));
}

async function verifyCandidateCasWithGrok({ handle, project, result, baseUrl }) {
  const candidates = normalizeCaList(result.candidate_cas);
  if (!candidates.length) return null;
  const prompt = `
You are doing targeted CA verification for @${handle}.

Project input:
- X handle: @${handle}
- Project name: ${project.project_name || 'unknown'}
- Website: ${project.website || 'unknown'}
- Chain: ${project.chain || 'unknown'}
- Notes: ${project.notes || 'none'}

Candidate addresses to verify exactly:
${candidates.map((item) => `- ${item.address} (${item.chain || 'unknown chain'})`).join('\n')}

Use X Search. For each exact address, search the address, shortened fragments,
@${handle}, ${handle}, project/ticker names, Bankr/bankrbot, Clanker/clanker_world,
pump.fun, fee claim posts, reward-owner posts, deploy posts, author posts, replies,
and quote tweets.

Return STRICT JSON only:
{
  "target_results": [
    {"address":"string","verified_status":"confirmed/candidate/rejected/not_found","chain":"string","ticker":"string","launchpad":"bankr/clanker/pump/other/unknown","attribution_source":"official/author/launchpad/community/other","source_url":"string","quote_or_summary":"string","confidence":"high/medium/low"}
  ],
  "confirmed_cas": [{"address":"string","chain":"string","ticker":"string","launchpad":"string","attribution_source":"official/author/launchpad/community/other","source_url":"string","confidence":"high/medium/low"}],
  "candidate_cas": [{"address":"string","chain":"string","source_url":"string","reason":"string","confidence":"high/medium/low"}],
  "evidence": [{"claim":"string","source_url":"string","quote_or_summary":"string","confidence":"high/medium/low"}],
  "notes": "string"
}

Rules:
- Confirm exact Bankr/Clanker/pump.fun token addresses when posts tie fees, rewards,
  deploys, community support, or project attribution to @${handle} or the project.
- Do not reject a community/launchpad token merely because @${handle} says they did
  not personally create tokens. Preserve the attribution type instead.
- Use candidate only for truncated addresses, unclear token role, or rumor-only attribution.
`.trim();

  const response = await postJson(`${baseUrl}/responses`, config.xai.apiKey, {
    model: config.xai.model,
    input: [{ role: 'user', content: prompt }],
    tools: [
      {
        type: 'x_search',
        allowed_x_handles: [handle, 'bankrbot', 'clanker_world', 'clanker'],
        enable_image_understanding: true
      }
    ]
  });
  return normalizeGrokResult(parseJsonFromText(extractResponsesText(response)));
}

export async function analyzeWithGrok(project, options = {}) {
  if (config.mockLLM) return mockGrok(project);
  if (!config.xai.apiKey) throw new Error('Missing XAI_API_KEY');

  const handle = cleanHandle(project.x_handle);
  const stage = options.stage || 'fast';
  const stageInstruction = auditStageInstruction(stage, options.previous);
  const prompt = `
You are collecting X evidence for a crypto project opportunity analysis.

Audit stage: ${stage.toUpperCase()}
${stageInstruction}

Project input:
- X handle: @${handle}
- Project name: ${project.project_name || 'unknown'}
- Website: ${project.website || 'unknown'}
- Chain: ${project.chain || 'unknown'}
- Notes: ${project.notes || 'none'}

Use X Search broadly but keep only official, launchpad, or directly relevant evidence.

Find evidence for:
1. What the project does, including product category, target users, chain/ecosystem, and core mechanism.
2. Whether the project has issued a token.
3. All confirmed CA / contract addresses. Multiple tokens are possible.
4. Candidate CA if the source is weak, the attribution is indirect, or the address context is ambiguous.
5. Wallet addresses if they are labeled as wallet, treasury, vault, team wallet, fee recipient, or similar. Do not treat wallet addresses as CA.
6. TGE date, month, quarter, or roadmap hints.
7. Airdrop, points, testnet, whitelist, campaign, or eligibility hints.
8. Recent important development in the last 90 days.

Search strategy:
- Check official X profile bio, pinned post, profile links, recent posts, older posts, replies, and quote tweets.
- Search for @${handle}, ${handle}, project name, ticker-like names, exact/partial addresses, and launch/trading links.
- If Project input Notes contain possible contract addresses, verify each exact address one by one and include every result in confirmed_cas or candidate_cas.
- Look for launchpad and community-token evidence from bankrbot, Bankr, Clanker, clanker_world, pump.fun, Zora coins, Virtuals, daos.fun, fjord, sunpump, four.meme, and moonshot.
- Look for phrases such as "CA:", "contract", "deployed", "launched", "ticker", "fee 100% to", "fees will flow to", "claim the fees", and "community token".
- Do not conclude "no token" only because the account says it did not create tokens. Community-created, launchpad-created, or fee-recipient tokens can still be associated with the account or project.
- For Bankr/Clanker style launches, exact token addresses in bot posts, fee-claim posts, reward-owner posts, or deploy posts are confirmed associated tokens when the post clearly ties rewards/fees/project attribution to the X handle or project.

Return STRICT JSON only, no markdown:
{
  "project_name": "string",
  "x_handle": "@handle",
  "project_intro": "1-3 Chinese sentences explaining what the project does",
  "token_status": ${JSON.stringify(TOKEN_STATUSES)},
  "confirmed_ca": "primary confirmed CA string or empty",
  "confirmed_cas": [{"address":"string","chain":"string","ticker":"string","launchpad":"string","attribution_source":"official/author/launchpad/community/other","source_url":"string","confidence":"high/medium/low"}],
  "candidate_cas": [{"address":"string","chain":"string","source":"string","confidence":"高/中/低"}],
  "wallet_addresses": [{"address":"string","label":"wallet/treasury/vault/team/fee recipient/unknown","source":"string","confidence":"高/中/低"}],
  "ca_confidence": "高/中/低/无",
  "tge_status": ${JSON.stringify(TGE_STATUSES)},
  "tge_time": "string or empty",
  "airdrop_status": "有明确机会/有暗示/暂无线索/不适用",
  "recent_developments": ["string"],
  "evidence": [{"claim":"string","source_url":"string","quote_or_summary":"string","confidence":"高/中/低"}],
  "risk_flags": ["string"],
  "confidence": "高/中/低",
  "notes": "string"
}

Rules:
- Mark CA as confirmed if official X, official website/docs, official announcement, verified explorer, CoinGecko, CMC, or a launchpad/bot post clearly attributes the token or fee stream to the account/project.
- If the account itself posts a community token address and says it supports the project, treat it as a confirmed associated token and explain the attribution.
- If a launchpad/bot post attributes a token, fee recipient, reward owner, or deploy to the account/project, include it in confirmed_cas or candidate_cas according to evidence strength.
- Treat an exact Bankr/Clanker/pump.fun token address as confirmed_cas when the evidence says fees, rewards, launch, or community support are tied to the account/project. Use candidate_cas only when the address is truncated, the token role is unclear, or attribution is only rumor.
- When an exact address appears in Notes and X Search finds a matching Bankr/Clanker/pump.fun/bot post or author post, do not drop it from confirmed_cas just because the account also denies personally creating tokens. Explain it as community/launchpad/fee-recipient attribution.
- Put every confirmed token in confirmed_cas. Set confirmed_ca to the first/highest-confidence CA for backward compatibility.
- If an address is labeled wallet, vault, treasury, team wallet, fee recipient, or "my wallet", put it in wallet_addresses, not confirmed_ca.
- If an address role or attribution is ambiguous, put it in candidate_cas and explain why.
- If no reliable CA exists, use an empty confirmed_ca, empty confirmed_cas, and explain in evidence.
- If TGE is not explicit, do not guess an exact date.
- Prefer direct evidence, but do not ignore older posts, replies, quote tweets, or launchpad accounts when they contain the CA.
`.trim();

  const baseUrl = config.xai.baseUrl.replace(/\/+$/, '');
  const response = await postJson(`${baseUrl}/responses`, config.xai.apiKey, {
    model: config.xai.model,
    input: [{ role: 'user', content: prompt }],
    tools: [
      {
        type: 'x_search',
        enable_image_understanding: true
      }
    ]
  });

  const text = extractResponsesText(response);
  const parsed = parseJsonFromText(text);
  let result = normalizeGrokResult(parsed);
  if (shouldVerifyCandidateCas(result)) {
    const verification = await verifyCandidateCasWithGrok({ handle, project, result, baseUrl });
    result = mergeVerifiedCas(result, verification);
  }
  if (shouldSearchAssociatedCas(result)) {
    const associated = await searchAssociatedCasWithGrok({ handle, project, result, baseUrl });
    result = mergeVerifiedCas(result, associated);
  }
  return {
    ...result,
    citations: collectCitations(response),
    raw_text: text
  };
}

export async function finalizeWithGpt(projects, options = {}) {
  if (config.mockLLM) return mockFinal(projects);
  if (options.provider === 'claude') return finalizeWithClaude(projects, options);
  if (!config.gpt.apiKey) throw new Error('Missing GPT_API_KEY or UNIVERSAL_API_KEY');

  const prompt = finalizerPrompt(projects, options);

  const baseUrl = config.gpt.baseUrl.replace(/\/+$/, '');
  const body = {
    model: config.gpt.model,
    messages: [
      {
        role: 'system',
        content:
          'You verify crypto project evidence and produce strict JSON in Chinese.'
      },
      { role: 'user', content: prompt }
    ],
    temperature: 0.1,
    response_format: { type: 'json_object' }
  };

  let response;
  try {
    response = await postJson(`${baseUrl}/chat/completions`, config.gpt.apiKey, body);
  } catch (error) {
    if (!String(error.message).includes('response_format')) throw error;
    const retryBody = { ...body };
    delete retryBody.response_format;
    response = await postJson(`${baseUrl}/chat/completions`, config.gpt.apiKey, retryBody);
  }

  return parseJsonFromText(extractChatText(response));
}

async function finalizeWithClaude(projects, options = {}) {
  if (!config.claude.apiKey) throw new Error('Missing CLAUDE_API_KEY');

  const baseUrl = config.claude.baseUrl.replace(/\/+$/, '');
  const response = await postJson(
    `${baseUrl}/messages`,
    config.claude.apiKey,
    {
      model: config.claude.model,
      max_tokens: 8192,
      temperature: 0.1,
      system: 'You verify crypto project evidence and produce strict JSON in Chinese.',
      messages: [{ role: 'user', content: finalizerPrompt(projects, options) }]
    },
    {
      headers: {
        'anthropic-version': '2023-06-01',
        'x-api-key': config.claude.apiKey,
        Authorization: undefined
      }
    }
  );

  const text = (response.content ?? [])
    .map((part) => part.text ?? '')
    .filter(Boolean)
    .join('\n')
    .trim();
  return parseJsonFromText(text);
}

function auditStageInstruction(stage, previous) {
  if (stage === 'deep') {
    return `
This is the second-pass Deep audit. Re-check the official profile bio, pinned post, profile links, and recent official posts.
Use the previous pass only as a hypothesis, not as truth:
${JSON.stringify(previous ?? {}, null, 2)}

Deep audit requirements:
- Find what the project actually does and avoid confusing founder/personal accounts with project accounts.
- Re-check every address context. Split token contract, candidate contract, wallet, treasury, vault, LP, and router addresses.
- Look for product progress, fundraising/backing signals, partnerships, and current user activity.
- Prefer evidence that can explain project quality, not only token status.
`.trim();
  }
  if (stage === 'verify') {
    return `
This is the third-pass Verify audit. Your job is adversarial verification.
Use the previous pass as claims to challenge:
${JSON.stringify(previous ?? {}, null, 2)}

Verify audit requirements:
- Look for contradictions, account migrations, impersonation risk, fake CA risk, and ambiguous wallet-vs-contract signals.
- Do not upgrade candidate CA to confirmed CA unless official evidence explicitly labels it as token contract / CA.
- If evidence is conflicting, keep the conservative result and add risk_flags / notes.
- Emphasize what still needs manual verification before any trading or interaction.
`.trim();
  }
  return `
This is the first-pass Fast audit. Collect the strongest official X evidence quickly and return conservative structured facts.
`.trim();
}

function finalizerPrompt(projects, options = {}) {
  const auditStage = options.auditStage || 'fast';
  return `
You are an analyst preparing a Chinese crypto airdrop/TGE opportunity report.

You receive Grok X-search outputs. Verify, rank, and normalize them.
Audit mode: ${auditStage.toUpperCase()}

Main objective:
- most important: whether token issued
- if token issued: confirmed CA(s), candidate CA(s), attribution type, and wallet-vs-contract distinction
- clearly explain what the project does
- second most important: projects close to TGE
- also consider airdrop/points/testnet opportunities

Do not invent facts. Do not invent CA. If evidence is weak, mark it as candidate or manual review.
Multiple tokens per account are possible. Preserve confirmed_cas when Grok provides it, and put the primary/highest-confidence CA in ca.

If audit_rounds are present:
- Fast round is initial evidence collection.
- Deep round is broader project-quality and address-context review.
- Verify round is adversarial contradiction/risk review.
- Prefer the most conservative verified conclusion when rounds conflict.

Scoring:
- token issuance / CA clarity: 35
- TGE proximity: 30
- airdrop/points/testnet opportunity: 15
- financing/backing signal from X evidence: 10
- recent activity: 10
- risk deduction up to -30

Return STRICT JSON only:
{
  "batch_summary": {
    "overview": "string",
    "high_priority_count": 0,
    "near_tge_count": 0,
    "issued_count": 0,
    "manual_review_count": 0,
    "top_opportunities": ["@handle"],
    "manual_review": ["@handle"]
  },
  "projects": [
    {
      "x_handle": "@handle",
      "project_name": "string",
      "project_intro": "1-3 Chinese sentences explaining what the project does",
      "score": 0,
      "grade": "S/A/B/C/D",
      "token_status": "string",
      "ca": "string or empty",
      "candidate_cas": [{"address":"string","chain":"string","source":"string","confidence":"高/中/低"}],
      "wallet_addresses": [{"address":"string","label":"wallet/treasury/vault/team/fee recipient/unknown","source":"string","confidence":"高/中/低"}],
      "ca_confidence": "高/中/低/无",
      "tge_status": "string",
      "tge_time": "string or empty",
      "airdrop_status": "string",
      "risk_level": "低/中/高",
      "summary": "string",
      "key_points": ["string"],
      "risks": ["string"],
      "next_actions": ["string"],
      "evidence": [{"claim":"string","source_url":"string","confidence":"高/中/低"}]
    }
  ]
}

Input:
${JSON.stringify(projects, null, 2)}
`.trim();
}

function hash(input) {
  let value = 0;
  for (const char of input) value = (value * 31 + char.charCodeAt(0)) >>> 0;
  return value;
}

function mockGrok(project) {
  const h = cleanHandle(project.x_handle);
  const seed = hash(h);
  const issued = seed % 5 === 0;
  const nearTge = seed % 3 === 0;
  const hinted = seed % 2 === 0;
  const ca = issued ? `0x${seed.toString(16).padStart(40, '0').slice(0, 40)}` : '';
  return {
    project_name: project.project_name || h.replace(/_/g, ' '),
    x_handle: `@${h}`,
    token_status: issued
      ? '已发币，CA已确认'
      : nearTge
        ? '确认将发币，未TGE'
        : hinted
          ? '强烈暗示发币'
          : '暂无发币迹象',
    confirmed_ca: ca,
    candidate_cas: [],
    ca_confidence: ca ? '高' : '无',
    tge_status: issued
      ? '已TGE'
      : nearTge
        ? '明确月份/季度'
        : hinted
          ? '路线图推断'
          : '暂无可靠信息',
    tge_time: nearTge ? '未来1-2个季度内，需人工确认' : '',
    airdrop_status: hinted || nearTge ? '有暗示' : '暂无线索',
    recent_developments: [
      '近期 X 动态显示项目仍在更新产品与社区活动。',
      nearTge ? '出现与上线、积分或生态活动相关的信号。' : '暂未看到明确 TGE 时间。'
    ],
    evidence: [
      {
        claim: 'Mock evidence for local UI testing',
        source_url: `https://x.com/${h}`,
        quote_or_summary: '本条为本地演示数据，不代表真实分析结果。',
        confidence: '低'
      }
    ],
    risk_flags: ca ? [] : ['需要真实 API 检索后确认 CA 与 TGE'],
    confidence: '低',
    notes: 'MOCK_LLM=true generated sample.',
    citations: [{ url: `https://x.com/${h}` }],
    raw_text: ''
  };
}

function mockFinal(projects) {
  const normalized = projects.map((project) => {
    const grok = project.grok ?? project;
    const input = project.input ?? project;
    const handle = grok.x_handle || input.x_handle || project.x_handle;
    const projectName = grok.project_name || input.project_name || handle;
    const score =
      primaryCaFrom(grok) ? 82 : grok.tge_status === '明确月份/季度' ? 78 : 58;
    const grade = score >= 80 ? 'A' : score >= 70 ? 'B' : 'C';
    return {
      x_handle: handle,
      project_name: projectName,
      score,
      grade,
      token_status: grok.token_status,
      ca: primaryCaFrom(grok),
      confirmed_cas: normalizeCaList(grok.confirmed_cas),
      ca_confidence: grok.ca_confidence,
      tge_status: grok.tge_status,
      tge_time: grok.tge_time,
      airdrop_status: grok.airdrop_status,
      risk_level: primaryCaFrom(grok) ? '低' : '中',
      summary: `${handle} 的本地演示结论：重点检查发币状态、CA 与 TGE 信号。`,
      key_points: grok.recent_developments ?? [],
      risks: grok.risk_flags ?? [],
      next_actions: [
        primaryCaFrom(grok) ? '核对合约与流动性' : '用真实 API 复查官方 X 与公告',
        '关注官方 X 的 TGE、airdrop、points 关键词'
      ],
      evidence: grok.evidence ?? []
    };
  });

  return {
    batch_summary: {
      overview: '本报告由 MOCK_LLM=true 生成，用于本地界面与流程测试。',
      high_priority_count: normalized.filter((item) => ['S', 'A'].includes(item.grade)).length,
      near_tge_count: normalized.filter((item) => item.tge_status !== '暂无可靠信息').length,
      issued_count: normalized.filter((item) => item.ca).length,
      manual_review_count: normalized.filter((item) => !item.ca).length,
      top_opportunities: normalized
        .filter((item) => ['S', 'A'].includes(item.grade))
        .map((item) => item.x_handle),
      manual_review: normalized.filter((item) => !item.ca).map((item) => item.x_handle)
    },
    projects: normalized
  };
}
