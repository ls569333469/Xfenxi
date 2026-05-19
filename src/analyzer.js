import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import {
  createBatch,
  getBatch,
  incrementBatchProgress,
  updateBatch,
  updateProject
} from './db.js';
import { analyzeWithGrok, finalizeWithGpt } from './models.js';
import { batchMarkdown, projectMarkdown } from './markdown.js';

const activeBatches = new Set();
const batchOptions = new Map();
const auditStages = {
  fast: { label: 'Fast', rounds: ['fast'] },
  deep: { label: 'Deep', rounds: ['fast', 'deep'] },
  verify: { label: 'Verify', rounds: ['fast', 'deep', 'verify'] }
};

function extractHandle(input) {
  const trimmed = String(input ?? '').trim();
  const urlMatch = trimmed.match(/(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{1,20})/i);
  const raw = urlMatch ? urlMatch[1] : trimmed.replace(/^@/, '');
  const match = raw.match(/[A-Za-z0-9_]{1,20}/);
  return match ? `@${match[0]}` : '';
}

export function parseInput(rawInput) {
  const rows = String(rawInput ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  const seen = new Set();
  const projects = [];

  for (const line of rows) {
    const parts = line.includes('|')
      ? line.split('|').map((part) => part.trim())
      : line.split('\t').map((part) => part.trim());

    const handle = extractHandle(parts[0]);
    if (!handle) continue;
    const key = handle.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    projects.push({
      id: randomUUID(),
      input_index: projects.length,
      x_handle: handle,
      project_name: parts[1] ?? '',
      website: parts[2] ?? '',
      chain: parts[3] ?? '',
      notes: parts.slice(4).join(' | ')
    });
  }

  if (projects.length === 0) {
    throw new Error('请至少输入一个有效的 X 账号');
  }
  if (projects.length > config.maxBatchSize) {
    throw new Error(`单批最多支持 ${config.maxBatchSize} 个 X 账号`);
  }

  return projects;
}

export function startAnalysis({ rawInput, name, finalizer, auditStage }) {
  const projects = parseInput(rawInput);
  const id = randomUUID();
  const normalizedFinalizer = finalizer === 'claude' ? 'claude' : 'gpt';
  const normalizedStage = auditStages[auditStage] ? auditStage : 'fast';
  const stageConfig = auditStages[normalizedStage];
  batchOptions.set(id, { finalizer: normalizedFinalizer, auditStage: normalizedStage });
  const batchName = name?.trim() || `Batch ${new Date().toLocaleString('zh-CN')}`;
  createBatch({
    id,
    name: batchName,
    projects,
    apiCallsPlanned: projects.length * stageConfig.rounds.length + 1
  });

  queueMicrotask(() => {
    runBatch(id).catch((error) => {
      updateBatch(id, {
        status: 'failed',
        error: error.message
      });
      activeBatches.delete(id);
      batchOptions.delete(id);
    });
  });

  return getBatch(id);
}

export function refinalizeBatch(id, { finalizer = 'gpt', auditStage = 'deep' } = {}) {
  const normalizedFinalizer = finalizer === 'claude' ? 'claude' : 'gpt';
  const normalizedStage = auditStages[auditStage] ? auditStage : 'deep';
  batchOptions.set(id, { finalizer: normalizedFinalizer, auditStage: normalizedStage });
  queueMicrotask(() => {
    finalizeBatch(id).catch((error) => {
      updateBatch(id, {
        status: 'failed',
        error: error.message
      });
      activeBatches.delete(id);
      batchOptions.delete(id);
    });
  });
  return getBatch(id);
}

async function runBatch(id) {
  if (activeBatches.has(id)) return;
  activeBatches.add(id);
  updateBatch(id, { status: 'running', error: '' });

  const batch = getBatch(id);
  const projects = batch.projects;
  const options = batchOptions.get(id) ?? {};
  const stageConfig = auditStages[options.auditStage] ?? auditStages.fast;
  await runPool(projects, config.concurrency, async (project) => {
    updateProject(project.id, { status: 'grok_running', error: '' });
    try {
      const grok = await runGrokAudit(project, stageConfig);
      updateProject(project.id, {
        status: 'grok_done',
        grok_raw: grok,
        token_status: textValue(grok.token_status),
        ca: primaryCaFrom(grok),
        ca_confidence: textValue(grok.ca_confidence),
        tge_status: textValue(grok.tge_status),
        tge_time: textValue(grok.tge_time),
        airdrop_status: textValue(grok.airdrop_status),
        risk_level: grok.risk_flags?.length ? '中' : '低',
        summary: grok.notes ?? ''
      });
      incrementBatchProgress(id, { completed: 1 });
    } catch (error) {
      updateProject(project.id, {
        status: 'failed',
        error: error.message
      });
      incrementBatchProgress(id, { failed: 1 });
    }
  });

  const afterGrok = getBatch(id);
  const successful = afterGrok.projects.filter((project) => project.status === 'grok_done');
  if (successful.length === 0) {
    updateBatch(id, {
      status: 'failed',
      error: '所有 Grok 检索都失败，无法生成报告'
    });
    activeBatches.delete(id);
    batchOptions.delete(id);
    return;
  }

  await finalizeBatch(id);
  activeBatches.delete(id);
  batchOptions.delete(id);
}

async function finalizeBatch(id) {
  updateBatch(id, { status: 'finalizing', error: '' });
  const afterGrok = getBatch(id);
  const successful = afterGrok.projects.filter((project) => project.grok_raw);
  if (successful.length === 0) {
    updateBatch(id, {
      status: 'failed',
      error: '没有可汇总的 Grok 结果'
    });
    activeBatches.delete(id);
    batchOptions.delete(id);
    return;
  }

  const options = batchOptions.get(id) ?? { finalizer: 'gpt', auditStage: 'deep' };
  const finalInput = successful.map((project) => ({
      id: project.id,
      input: {
        x_handle: project.x_handle,
        project_name: project.project_name,
        website: project.website,
        chain: project.chain,
        notes: project.notes
      },
      grok: compactGrok(project.grok_raw)
    }));
  let final;
  try {
    final = await finalizeWithGpt(finalInput, {
      provider: options.finalizer,
      auditStage: options.auditStage
    });
  } catch (error) {
    final = fallbackFinal(finalInput, error);
  }

  const finalByHandle = new Map(
    (final.projects ?? []).map((project) => [
      String(project.x_handle ?? '').toLowerCase().replace(/^@/, ''),
      project
    ])
  );

  const normalizedProjects = [];
  for (const project of successful) {
    const handleKey = project.x_handle.toLowerCase().replace(/^@/, '');
    const finalProject = normalizeFinalProject(
      finalByHandle.get(handleKey),
      project
    );
    const markdown = projectMarkdown({ ...project, final: finalProject });
    updateProject(project.id, {
      status: 'completed',
      score: finalProject.score,
      grade: finalProject.grade,
      token_status: finalProject.token_status,
      ca: finalProject.ca,
      ca_confidence: finalProject.ca_confidence,
      tge_status: finalProject.tge_status,
      tge_time: finalProject.tge_time,
      airdrop_status: finalProject.airdrop_status,
      risk_level: finalProject.risk_level,
      summary: finalProject.summary,
      final_json: finalProject,
      markdown
    });
    normalizedProjects.push(finalProject);
  }

  const finalBatch = getBatch(id);
  const markdown = batchMarkdown(finalBatch, normalizedProjects, final.batch_summary);
  const hardFailed = afterGrok.projects.filter((project) => project.status === 'failed' && !project.grok_raw).length;
  updateBatch(id, {
    status: hardFailed > 0 ? 'completed_with_errors' : 'completed',
    failed: hardFailed,
    summary_json: final.batch_summary ?? {},
    markdown
  });
}

function fallbackFinal(projects, error) {
  const normalized = projects.map((project) => {
    const grok = project.grok ?? {};
    const input = project.input ?? {};
    const score = heuristicScore(grok);
    return {
      x_handle: grok.x_handle || input.x_handle,
      project_name: grok.project_name || input.project_name || input.x_handle,
      project_intro: grok.project_intro || inferProjectIntro(input, grok),
      score,
      grade: gradeFromScore(score),
      token_status: textValue(grok.token_status) || '信息不足，需人工确认',
      ca: primaryCaFrom(grok),
      confirmed_cas: normalizeAddressList(grok.confirmed_cas),
      candidate_cas: normalizeAddressList(grok.candidate_cas),
      wallet_addresses: normalizeAddressList(grok.wallet_addresses),
      ca_confidence: textValue(grok.ca_confidence) || '无',
      tge_status: textValue(grok.tge_status) || '暂无可靠信息',
      tge_time: textValue(grok.tge_time),
      airdrop_status: textValue(grok.airdrop_status) || '暂无线索',
      risk_level: normalizeAddressList(grok.risk_flags).length ? '中' : '低',
      summary: textValue(grok.notes) || textValue(grok.project_intro),
      key_points: normalizeList(grok.recent_developments),
      risks: normalizeList(grok.risk_flags),
      next_actions: ['人工复核官方 X、官网、链上浏览器和 CA 一致性'],
      evidence: normalizeList(grok.evidence)
    };
  });

  return {
    batch_summary: {
      overview: `GPT/Claude 批量汇总失败，已使用 Grok 深度结果生成兜底汇总。错误：${error.message.slice(0, 180)}`,
      high_priority_count: normalized.filter((project) => ['S', 'A'].includes(project.grade)).length,
      near_tge_count: normalized.filter((project) => !String(project.tge_status).includes('暂无可靠')).length,
      issued_count: normalized.filter((project) => project.ca || String(project.token_status).includes('已发币')).length,
      manual_review_count: normalized.filter((project) => !project.ca || project.risk_level !== '低').length,
      top_opportunities: normalized.filter((project) => ['S', 'A'].includes(project.grade)).map((project) => project.x_handle),
      manual_review: normalized.filter((project) => !project.ca || project.risk_level !== '低').map((project) => project.x_handle)
    },
    projects: normalized
  };
}

function compactGrok(grok) {
  if (!grok) return null;
  return {
    project_name: grok.project_name,
    x_handle: grok.x_handle,
    project_intro: grok.project_intro,
    token_status: grok.token_status,
    confirmed_ca: grok.confirmed_ca,
    confirmed_cas: grok.confirmed_cas,
    candidate_cas: grok.candidate_cas,
    wallet_addresses: grok.wallet_addresses,
    ca_confidence: grok.ca_confidence,
    tge_status: grok.tge_status,
    tge_time: grok.tge_time,
    airdrop_status: grok.airdrop_status,
    recent_developments: grok.recent_developments,
    evidence: grok.evidence,
    risk_flags: grok.risk_flags,
    confidence: grok.confidence,
    notes: grok.notes,
    audit_stage: grok.audit_stage,
    audit_rounds: compactAuditRounds(grok.audit_rounds)
  };
}

function compactAuditRounds(rounds) {
  if (!Array.isArray(rounds)) return [];
  return rounds.map((round) => ({
    stage: round.stage,
    token_status: round.result?.token_status,
    confirmed_ca: round.result?.confirmed_ca,
    confirmed_cas: round.result?.confirmed_cas,
    candidate_cas: round.result?.candidate_cas,
    wallet_addresses: round.result?.wallet_addresses,
    ca_confidence: round.result?.ca_confidence,
    risk_flags: round.result?.risk_flags,
    notes: round.result?.notes
  }));
}

async function runGrokAudit(project, stageConfig) {
  const rounds = [];
  let current = null;
  for (const round of stageConfig.rounds) {
    current = await analyzeWithGrok(project, {
      stage: round,
      previous: current
    });
    rounds.push({
      stage: round,
      result: current
    });
  }
  return {
    ...current,
    audit_stage: stageConfig.label,
    audit_rounds: rounds
  };
}

async function runPool(items, limit, worker) {
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index++];
      await worker(item);
    }
  });
  await Promise.all(workers);
}

function normalizeFinalProject(finalProject, sourceProject) {
  const grok = sourceProject.grok_raw ?? {};
  const score = clampScore(finalProject?.score ?? heuristicScore(grok));
  return {
    x_handle: finalProject?.x_handle || sourceProject.x_handle,
    project_name:
      finalProject?.project_name ||
      grok.project_name ||
      sourceProject.project_name ||
      sourceProject.x_handle,
    score,
    grade: finalProject?.grade || gradeFromScore(score),
    project_intro:
      finalProject?.project_intro ||
      grok.project_intro ||
      inferProjectIntro(sourceProject, grok),
    token_status: textValue(finalProject?.token_status || grok.token_status) || '信息冲突，需人工确认',
    ca: textValue(finalProject?.ca || primaryCaFrom(grok)),
    confirmed_cas: normalizeAddressList(finalProject?.confirmed_cas || grok.confirmed_cas),
    candidate_cas: normalizeAddressList(finalProject?.candidate_cas || grok.candidate_cas),
    wallet_addresses: normalizeAddressList(finalProject?.wallet_addresses || grok.wallet_addresses),
    ca_confidence: textValue(finalProject?.ca_confidence || grok.ca_confidence) || '无',
    tge_status: textValue(finalProject?.tge_status || grok.tge_status) || '暂无可靠信息',
    tge_time: textValue(finalProject?.tge_time || grok.tge_time),
    airdrop_status: textValue(finalProject?.airdrop_status || grok.airdrop_status) || '暂无线索',
    risk_level: textValue(finalProject?.risk_level) || (grok.risk_flags?.length ? '中' : '低'),
    summary: textValue(finalProject?.summary || grok.notes),
    key_points: finalProject?.key_points || grok.recent_developments || [],
    risks: finalProject?.risks || grok.risk_flags || [],
    next_actions: finalProject?.next_actions || ['人工复查官方 X、CA 与 TGE 证据'],
    evidence: finalProject?.evidence || grok.evidence || []
  };
}

function textValue(value) {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.filter(Boolean).join('；');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function normalizeAddressList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string') return value.trim() ? [{ address: value.trim() }] : [];
  return [value];
}

function primaryCaFrom(value) {
  const confirmed = normalizeAddressList(value?.confirmed_cas);
  return confirmed[0]?.address || textValue(value?.confirmed_ca);
}

function normalizeList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  return [value];
}

function inferProjectIntro(sourceProject, grok) {
  const pieces = [];
  if (grok.project_name || sourceProject.project_name) {
    pieces.push(`${grok.project_name || sourceProject.project_name} 是一个加密项目`);
  }
  if (sourceProject.chain) pieces.push(`所属生态/链：${sourceProject.chain}`);
  if (sourceProject.website) pieces.push(`官网：${sourceProject.website}`);
  return pieces.length ? `${pieces.join('，')}。` : '';
}

function heuristicScore(grok) {
  let score = 35;
  if (primaryCaFrom(grok)) score += 25;
  if (['明确TGE日期', '明确月份/季度'].includes(grok.tge_status)) score += 25;
  if (grok.airdrop_status === '有明确机会') score += 10;
  if (grok.airdrop_status === '有暗示') score += 6;
  if (grok.risk_flags?.length) score -= 10;
  return score;
}

function clampScore(value) {
  const score = Number.parseInt(value, 10);
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, score));
}

function gradeFromScore(score) {
  if (score >= 90) return 'S';
  if (score >= 80) return 'A';
  if (score >= 70) return 'B';
  if (score >= 50) return 'C';
  return 'D';
}
