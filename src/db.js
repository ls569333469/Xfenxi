import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dataDir = path.join(process.cwd(), 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'app.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS batches (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT NOT NULL,
    total INTEGER NOT NULL DEFAULT 0,
    completed INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0,
    api_calls_planned INTEGER NOT NULL DEFAULT 0,
    summary_json TEXT,
    markdown TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    batch_id TEXT NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
    input_index INTEGER NOT NULL,
    x_handle TEXT NOT NULL,
    project_name TEXT,
    website TEXT,
    chain TEXT,
    notes TEXT,
    status TEXT NOT NULL,
    score INTEGER,
    grade TEXT,
    token_status TEXT,
    ca TEXT,
    ca_confidence TEXT,
    tge_status TEXT,
    tge_time TEXT,
    airdrop_status TEXT,
    risk_level TEXT,
    summary TEXT,
    grok_raw TEXT,
    final_json TEXT,
    markdown TEXT,
    error TEXT,
    visibility TEXT NOT NULL DEFAULT 'active',
    hidden_at TEXT,
    hidden_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_projects_batch_id ON projects(batch_id);
  CREATE INDEX IF NOT EXISTS idx_batches_created_at ON batches(created_at DESC);
`);

ensureProjectVisibilityColumns();

function ensureProjectVisibilityColumns() {
  const columns = new Set(
    db.prepare('PRAGMA table_info(projects)').all().map((column) => column.name)
  );
  if (!columns.has('visibility')) {
    db.exec("ALTER TABLE projects ADD COLUMN visibility TEXT NOT NULL DEFAULT 'active'");
  }
  if (!columns.has('hidden_at')) {
    db.exec('ALTER TABLE projects ADD COLUMN hidden_at TEXT');
  }
  if (!columns.has('hidden_reason')) {
    db.exec('ALTER TABLE projects ADD COLUMN hidden_reason TEXT');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_projects_visibility ON projects(visibility)');
}

function now() {
  return new Date().toISOString();
}

function parseJson(value, fallback = null) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function hydrateBatch(row) {
  if (!row) return null;
  return {
    ...row,
    summary: parseJson(row.summary_json, null)
  };
}

function hydrateProject(row) {
  if (!row) return null;
  const grok = parseJson(row.grok_raw, null);
  const final = parseJson(row.final_json, null);
  return {
    ...row,
    grok_raw: grok,
    final,
    project_intro:
      final?.project_intro ||
      grok?.project_intro ||
      final?.summary ||
      row.summary ||
      '',
    candidate_cas: normalizeAddressList(final?.candidate_cas || grok?.candidate_cas),
    wallet_addresses: normalizeAddressList(final?.wallet_addresses || grok?.wallet_addresses)
  };
}

export function createBatch({ id, name, projects, apiCallsPlanned }) {
  const stamp = now();
  db.prepare(`
    INSERT INTO batches (
      id, name, status, total, completed, failed, api_calls_planned, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, 'queued', projects.length, 0, 0, apiCallsPlanned, stamp, stamp);

  const insertProject = db.prepare(`
    INSERT INTO projects (
      id, batch_id, input_index, x_handle, project_name, website, chain, notes,
      status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const project of projects) {
    setProjectVisibilityByHandle(project.x_handle, 'active');
    insertProject.run(
      project.id,
      id,
      project.input_index,
      project.x_handle,
      project.project_name ?? '',
      project.website ?? '',
      project.chain ?? '',
      project.notes ?? '',
      'queued',
      stamp,
      stamp
    );
  }
}

export function updateBatch(id, updates) {
  const allowed = [
    'name',
    'status',
    'completed',
    'failed',
    'api_calls_planned',
    'summary_json',
    'markdown',
    'error'
  ];
  const entries = Object.entries(updates).filter(([key]) => allowed.includes(key));
  if (!entries.length) return;
  const sets = entries.map(([key]) => `${key} = ?`);
  const values = entries.map(([, value]) =>
    typeof value === 'object' && value !== null ? JSON.stringify(value) : value
  );
  sets.push('updated_at = ?');
  values.push(now(), id);
  db.prepare(`UPDATE batches SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

export function updateProject(id, updates) {
  const allowed = [
    'status',
    'score',
    'grade',
    'token_status',
    'ca',
    'ca_confidence',
    'tge_status',
    'tge_time',
    'airdrop_status',
    'risk_level',
    'summary',
    'grok_raw',
    'final_json',
    'markdown',
    'error',
    'visibility',
    'hidden_at',
    'hidden_reason'
  ];
  const entries = Object.entries(updates).filter(([key]) => allowed.includes(key));
  if (!entries.length) return;
  const sets = entries.map(([key]) => `${key} = ?`);
  const values = entries.map(([, value]) =>
    typeof value === 'object' && value !== null ? JSON.stringify(value) : value
  );
  sets.push('updated_at = ?');
  values.push(now(), id);
  db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

export function incrementBatchProgress(id, { completed = 0, failed = 0 }) {
  db.prepare(`
    UPDATE batches
    SET completed = completed + ?, failed = failed + ?, updated_at = ?
    WHERE id = ?
  `).run(completed, failed, now(), id);
}

export function listBatches() {
  return db.prepare(`
    SELECT * FROM batches
    ORDER BY created_at DESC
    LIMIT 50
  `).all().map(hydrateBatch);
}

export function listProjects({ limit = 500 } = {}) {
  const rows = db.prepare(`
    SELECT
      p.*,
      b.name AS batch_name,
      b.created_at AS batch_created_at,
      b.status AS batch_status
    FROM projects p
    JOIN batches b ON b.id = p.batch_id
    ORDER BY p.updated_at DESC
    LIMIT ?
  `).all(limit).map((row) => {
    const grok = parseJson(row.grok_raw, null);
    const final = parseJson(row.final_json, null);
    return {
      ...row,
      grok_raw: grok,
      final,
      project_intro:
        final?.project_intro ||
        grok?.project_intro ||
        final?.summary ||
        row.summary ||
        '',
      candidate_cas: normalizeAddressList(final?.candidate_cas || grok?.candidate_cas),
      wallet_addresses: normalizeAddressList(final?.wallet_addresses || grok?.wallet_addresses)
    };
  });
  return uniqueLatestProjects(rows, { max: 200 });
}

export function setProjectVisibilityByHandle(handle, visibility, reason = '') {
  const key = normalizeHandle(handle);
  if (!key) return { changed: 0 };
  const hiddenAt = visibility === 'hidden' ? now() : null;
  const hiddenReason = visibility === 'hidden' ? String(reason ?? '').trim() : '';
  const result = db.prepare(`
    UPDATE projects
    SET visibility = ?,
        hidden_at = ?,
        hidden_reason = ?,
        updated_at = ?
    WHERE lower(replace(x_handle, '@', '')) = ?
  `).run(visibility, hiddenAt, hiddenReason, now(), key);
  return { changed: result.changes ?? 0 };
}

export function getBatch(id) {
  const batch = hydrateBatch(
    db.prepare('SELECT * FROM batches WHERE id = ?').get(id)
  );
  if (!batch) return null;
  batch.projects = db.prepare(`
    SELECT * FROM projects
    WHERE batch_id = ?
    ORDER BY input_index ASC
  `).all(id).map(hydrateProject);
  return batch;
}

function normalizeAddressList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string') return value.trim() ? [{ address: value.trim() }] : [];
  return [value];
}

function uniqueLatestProjects(projects, { max = Infinity } = {}) {
  const groups = new Map();
  for (const project of projects) {
    if (isMockProject(project)) continue;
    if (project.batch_status === 'failed' || project.status === 'failed') continue;
    const key = normalizeHandle(project.x_handle);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(project);
  }

  return [...groups.values()]
    .map((items) => {
      const sorted = [...items].sort(compareProjectFreshness);
      const selected = sorted[0];
      return {
        ...selected,
        duplicate_count: items.length,
        hidden_duplicate_count: Math.max(0, items.length - 1),
        visibility: selected.visibility || 'active'
      };
    })
    .sort(compareProjectFreshness)
    .slice(0, max);
}

function normalizeHandle(handle) {
  return String(handle ?? '').trim().replace(/^@/, '').toLowerCase();
}

function compareProjectFreshness(a, b) {
  const rankDiff = projectRank(a) - projectRank(b);
  if (rankDiff !== 0) return rankDiff;
  return new Date(b.updated_at || b.batch_created_at || 0) - new Date(a.updated_at || a.batch_created_at || 0);
}

function projectRank(project) {
  if (project.status === 'completed') return 0;
  if (project.status === 'grok_done' && project.grok_raw) return 1;
  if (project.batch_status === 'completed' || project.batch_status === 'completed_with_errors') return 2;
  if (project.grok_raw || project.final) return 3;
  return 9;
}

function isMockProject(project) {
  const text = [
    project.batch_name,
    project.summary,
    project.markdown,
    project.project_intro,
    project.grok_raw?.notes,
    project.grok_raw?.raw_text,
    project.final?.summary
  ].filter(Boolean).join('\n');
  return /MOCK_LLM=true|Mock Test|MVP Mock|本地演示数据/i.test(text);
}

export function getProject(id) {
  return hydrateProject(db.prepare('SELECT * FROM projects WHERE id = ?').get(id));
}

export function recoverInterruptedRuns() {
  const stamp = now();
  repairFailedBatchCounts(stamp);
  repairCompletedFinalizingBatches(stamp);
  const interruptedBatches = db.prepare(`
    SELECT id FROM batches
    WHERE status IN ('queued', 'running', 'finalizing')
      AND (summary_json IS NULL OR summary_json = '')
  `).all();
  if (!interruptedBatches.length) return 0;

  const ids = interruptedBatches.map((row) => row.id);
  const placeholders = ids.map(() => '?').join(', ');
  db.prepare(`
    UPDATE projects
    SET status = 'failed',
        error = CASE
          WHEN error IS NULL OR error = '' THEN '服务重启，任务已中断，请重新运行'
          ELSE error
        END,
        updated_at = ?
    WHERE batch_id IN (${placeholders})
      AND status IN ('queued', 'grok_running', 'grok_done')
  `).run(stamp, ...ids);

  db.prepare(`
    UPDATE batches
    SET status = 'failed',
        failed = (
          SELECT COUNT(*)
          FROM projects
          WHERE projects.batch_id = batches.id
            AND projects.status = 'failed'
        ),
        error = CASE
          WHEN error IS NULL OR error = '' THEN '服务重启，任务已中断，请重新运行'
          ELSE error
        END,
        updated_at = ?
    WHERE id IN (${placeholders})
  `).run(stamp, ...ids);

  return interruptedBatches.length;
}

function repairCompletedFinalizingBatches(stamp = now()) {
  db.prepare(`
    UPDATE batches
    SET status = CASE
          WHEN failed > 0 THEN 'completed_with_errors'
          ELSE 'completed'
        END,
        updated_at = ?
    WHERE status = 'finalizing'
      AND summary_json IS NOT NULL
      AND summary_json != ''
  `).run(stamp);
}

function repairFailedBatchCounts(stamp = now()) {
  db.prepare(`
    UPDATE batches
    SET failed = (
      SELECT COUNT(*)
      FROM projects
      WHERE projects.batch_id = batches.id
        AND projects.status = 'failed'
    ),
    updated_at = ?
    WHERE status = 'failed'
      AND failed != (
        SELECT COUNT(*)
        FROM projects
        WHERE projects.batch_id = batches.id
          AND projects.status = 'failed'
      )
  `).run(stamp);
}

export function stats() {
  const projects = latestProjectsForStats();
  const activeProjects = projects.filter((project) => (project.visibility || 'active') !== 'hidden');
  const batchStats = db.prepare(`
    SELECT
      COUNT(*) AS total_batches,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_batches,
      SUM(CASE WHEN status IN ('queued', 'running', 'finalizing') THEN 1 ELSE 0 END) AS running_batches
    FROM batches
  `).get();

  return {
    ...batchStats,
    total_projects: activeProjects.length,
    hidden_projects: projects.length - activeProjects.length,
    high_priority: activeProjects.filter((project) => ['S', 'A'].includes(project.grade)).length,
    token_issued: activeProjects.filter((project) => project.ca).length,
    tge_watch: activeProjects.filter((project) =>
      project.tge_status &&
      !String(project.tge_status).includes('暂无') &&
      !String(project.tge_status).includes('无可靠')
    ).length
  };
}

function latestProjectsForStats() {
  const rows = db.prepare(`
    SELECT
      p.*,
      b.name AS batch_name,
      b.created_at AS batch_created_at,
      b.status AS batch_status
    FROM projects p
    JOIN batches b ON b.id = p.batch_id
    ORDER BY p.updated_at DESC
  `).all().map((row) => {
    const grok = parseJson(row.grok_raw, null);
    const final = parseJson(row.final_json, null);
    return {
      ...row,
      grok_raw: grok,
      final,
      project_intro:
        final?.project_intro ||
        grok?.project_intro ||
        final?.summary ||
        row.summary ||
        '',
      candidate_cas: normalizeAddressList(final?.candidate_cas || grok?.candidate_cas),
      wallet_addresses: normalizeAddressList(final?.wallet_addresses || grok?.wallet_addresses)
    };
  });
  return uniqueLatestProjects(rows);
}
