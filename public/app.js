const state = {
  config: null,
  batches: [],
  projects: [],
  currentBatch: null,
  polling: null,
  overviewFilters: {
    token: 'all',
    ca: 'all',
    visibility: 'active'
  },
  batchFilters: {
    token: 'all',
    ca: 'all'
  }
};

const els = {
  runtime: document.querySelector('#runtime'),
  rawInput: document.querySelector('#rawInput'),
  batchName: document.querySelector('#batchName'),
  finalizer: document.querySelector('#finalizer'),
  auditStage: document.querySelector('#auditStage'),
  startButton: document.querySelector('#startButton'),
  forceStartButton: document.querySelector('#forceStartButton'),
  sampleButton: document.querySelector('#sampleButton'),
  duplicateNotice: document.querySelector('#duplicateNotice'),
  activeBatch: document.querySelector('#activeBatch'),
  statsGrid: document.querySelector('#statsGrid'),
  projectOverview: document.querySelector('#projectOverview'),
  historyList: document.querySelector('#historyList'),
  refreshDashboard: document.querySelector('#refreshDashboard'),
  refreshHistory: document.querySelector('#refreshHistory')
};

init();

async function init() {
  bindEvents();
  state.config = await getJson('/api/config');
  renderRuntime();
  renderFinalizerOptions();
  await refreshAll();
}

function bindEvents() {
  document.querySelectorAll('.nav-item').forEach((button) => {
    button.addEventListener('click', () => showView(button.dataset.view));
  });

  els.sampleButton.addEventListener('click', () => {
    els.rawInput.value = [
      '@monad_xyz | Monad | https://monad.xyz | Monad | 重点看 TGE',
      '@berachain | Berachain | https://berachain.com | Berachain | 关注代币和空投',
      '@eclipsefnd | Eclipse | https://eclipse.xyz | Ethereum/Solana | 观察是否发币'
    ].join('\n');
  });

  els.startButton.addEventListener('click', startAnalysis);
  els.forceStartButton.addEventListener('click', () => startAnalysis({ force: true }));
  els.rawInput.addEventListener('input', renderDuplicateNotice);
  els.refreshDashboard.addEventListener('click', refreshAll);
  els.refreshHistory.addEventListener('click', refreshAll);
  document.addEventListener('click', openXInDefaultBrowser);
}

function showView(view) {
  document.querySelectorAll('.nav-item').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === view);
  });
  document.querySelectorAll('.view').forEach((section) => {
    section.classList.toggle('active', section.id === `view-${view}`);
  });
}

async function refreshAll() {
  const [stats, batchData, projectData] = await Promise.all([
    getJson('/api/stats'),
    getJson('/api/batches'),
    getJson('/api/projects')
  ]);
  state.batches = batchData.batches || [];
  state.projects = projectData.projects || [];
  renderStats(stats);
  renderProjectOverview();
  renderHistory();
  renderDuplicateNotice();
}

async function startAnalysis({ force = false } = {}) {
  const rawInput = els.rawInput.value.trim();
  if (!rawInput) {
    renderError('请输入至少一个 X 账号');
    return;
  }
  const effectiveInput = force ? rawInput : removeDuplicateInputRows(rawInput);
  if (!effectiveInput.trim()) {
    renderError('输入账号都已存在于项目汇总中。如需重跑，请点击“仍然重新分析全部”。');
    return;
  }

  els.startButton.disabled = true;
  els.forceStartButton.disabled = true;
  els.startButton.textContent = '分析中';
  els.activeBatch.innerHTML = '';

  try {
    const result = await postJson('/api/analyze', {
      rawInput: effectiveInput,
      name: els.batchName.value.trim(),
      finalizer: els.finalizer?.value || 'gpt',
      auditStage: els.auditStage?.value || 'fast'
    });
    state.currentBatch = result.batch;
    renderBatch(state.currentBatch);
    startPolling(state.currentBatch.id);
    showView('analyze');
  } catch (error) {
    renderError(error.message);
  } finally {
    els.startButton.disabled = false;
    els.forceStartButton.disabled = false;
    els.startButton.textContent = '开始分析';
  }
}

function startPolling(batchId) {
  if (state.polling) clearInterval(state.polling);
  const tick = async () => {
    const result = await getJson(`/api/batches/${batchId}`);
    state.currentBatch = result.batch;
    renderBatch(state.currentBatch);
    if (!isActiveStatus(state.currentBatch.status)) {
      clearInterval(state.polling);
      state.polling = null;
      await refreshAll();
    }
  };
  state.polling = setInterval(tick, 2500);
  tick();
}

function isActiveStatus(status) {
  return ['queued', 'running', 'finalizing'].includes(status);
}

function renderRuntime() {
  const cfg = state.config || {};
  els.runtime.innerHTML = `
    <strong>运行配置</strong>
    <p>Grok: ${escapeHtml(cfg.xaiModel || '-')}</p>
    <p>GPT: ${escapeHtml(cfg.gptModel || '-')}</p>
    <p>Claude: ${escapeHtml(cfg.claudeModel || '-')}</p>
    <p>单批上限: ${cfg.maxBatchSize || 20}</p>
    <p>模式: ${cfg.mockLLM ? '模拟演示' : '真实 API'}</p>
  `;
}

function renderFinalizerOptions() {
  if (!els.finalizer || state.config?.hasClaude) return;
  const option = els.finalizer.querySelector('option[value="claude"]');
  if (option) {
    option.disabled = true;
    option.textContent = 'Claude（未配置）';
  }
}

function renderStats(stats) {
  const items = [
    ['历史批次', stats.total_batches || 0],
    ['项目总数', stats.total_projects || 0],
    ['已隐藏', stats.hidden_projects || 0],
    ['高优先级', stats.high_priority || 0],
    ['TGE 观察', stats.tge_watch || 0]
  ];
  els.statsGrid.innerHTML = items
    .map(([label, value]) => `
      <div class="stat">
        <span>${label}</span>
        <strong>${value}</strong>
      </div>
    `)
    .join('');
}

function renderProjectOverview() {
  if (!state.projects.length) {
    els.projectOverview.innerHTML = '<div class="empty-state">暂无项目数据。</div>';
    return;
  }
  const filteredProjects = filteredOverviewProjects();
  els.projectOverview.innerHTML = `
    <div class="section-head">
      <div>
        <h3>项目汇总</h3>
        <p>每个 X 账号仅显示最新有效记录，历史批次仍在“历史报告”中保留。</p>
      </div>
      ${visibilityPanel('overview', state.overviewFilters)}
      ${filterPanel('overview', state.overviewFilters)}
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>项目</th>
            <th>X账号</th>
            <th>项目简介</th>
            <th>发币状态</th>
            <th>CA</th>
            <th>候选/钱包</th>
            <th>TGE</th>
            <th>空投</th>
            <th>质量分</th>
            <th>等级</th>
            <th>风险</th>
            <th>投研</th>
          </tr>
        </thead>
        <tbody>
          ${filteredProjects.map(projectOverviewRow).join('')}
        </tbody>
      </table>
    </div>
  `;
  decorateVisibilityButtons(els.projectOverview);
  bindOpenButtons(els.projectOverview);
  bindFilterPanel(els.projectOverview, 'overview');
}

function projectOverviewRow(project) {
  const hidden = isHiddenProject(project);
  return `
    <tr class="${hidden ? 'is-hidden' : ''}">
      <td>${escapeHtml(project.project_name || project.x_handle)}</td>
      <td class="mono">${xLink(project.x_handle)}</td>
      <td class="wide-cell">${escapeHtml(project.project_intro || project.summary || '-')}</td>
      <td>${tokenBadge(project)}</td>
      <td>${caBadge(project)}</td>
      <td>${addressSummary(project)}</td>
      <td>${escapeHtml(project.tge_status || '-')}<br><span class="muted">${escapeHtml(project.tge_time || '')}</span></td>
      <td>${escapeHtml(project.airdrop_status || '-')}</td>
      <td>${project.score ?? '-'}</td>
      <td>${project.grade ? `<span class="grade ${project.grade.toLowerCase()}">${project.grade}</span>` : '-'}</td>
      <td>${project.risk_level ? `<span class="risk ${riskClass(project.risk_level)}">${escapeHtml(project.risk_level)}</span>` : '-'}</td>
      <td>
        <button class="table-button" data-open-project="${project.batch_id}" data-project-id="${project.id}">查看投研</button>
        ${project.hidden_duplicate_count ? `<div class="muted small-text">已隐藏 ${project.hidden_duplicate_count} 条旧记录</div>` : ''}
      </td>
    </tr>
  `;
}

function filteredOverviewProjects() {
  return applyProjectFilters(state.projects, state.overviewFilters);
}

function isHiddenProject(project) {
  return (project.visibility || 'active') === 'hidden';
}

function tokenBadge(project) {
  const category = tokenCategory(project);
  const labelMap = {
    issued: '已发币',
    unissued: '未发币',
    signal: '发币线索',
    review: '需复核'
  };
  const detail = project.token_status || statusLabel(project.status);
  return `
    <span class="token-badge ${category}">${labelMap[category] || '需复核'}</span>
    <div class="status-detail">${escapeHtml(detail || '-')}</div>
  `;
}

function tokenCategory(project) {
  const status = String(project.token_status || '').toLowerCase();
  if (project.status === 'failed' || project.batch_status === 'failed') return 'review';
  if (project.ca) return 'issued';
  if (status.includes('已发币') || status.includes('已发布') || status.includes('已发行') || status.includes('已tge') || status.includes('已 tge')) return 'issued';
  if (status.includes('将发币') || status.includes('暗示') || status.includes('线索')) return 'signal';
  if (status.includes('暂无') || status.includes('不发币') || status.includes('未发现') || status.includes('未确认代币已发行')) return 'unissued';
  return 'review';
}

function caBadge(project) {
  const category = caCategory(project);
  const labelMap = {
    confirmed: 'CA 已确认',
    review: 'CA 待复核',
    none: '无 CA'
  };
  return `
    <span class="ca-badge ${category}">${labelMap[category]}</span>
    <div class="mono status-detail">${escapeHtml(project.ca || caDetail(project))}</div>
  `;
}

function caCategory(project) {
  if (project.ca) return 'confirmed';
  const candidateCount = normalizeAddressList(project.candidate_cas || project.final?.candidate_cas || project.grok_raw?.candidate_cas).length;
  const status = String(project.token_status || '').toLowerCase();
  if (candidateCount || status.includes('ca存疑') || status.includes('ca 存疑') || status.includes('候选')) return 'review';
  return 'none';
}

function caDetail(project) {
  const candidateCount = normalizeAddressList(project.candidate_cas || project.final?.candidate_cas || project.grok_raw?.candidate_cas).length;
  if (candidateCount) return `候选 ${candidateCount} 个`;
  return '未确认';
}

function filterPanel(scope, filters) {
  return `
    <div class="filter-panel" data-filter-scope="${scope}">
      <div class="filter-group">
        <span>发币状态</span>
        ${filterButton(scope, 'token', 'all', '全部', filters.token)}
        ${filterButton(scope, 'token', 'issued', '已发币', filters.token)}
        ${filterButton(scope, 'token', 'unissued', '未发币', filters.token)}
        ${filterButton(scope, 'token', 'signal', '发币线索', filters.token)}
        ${filterButton(scope, 'token', 'review', '需复核', filters.token)}
      </div>
      <div class="filter-group">
        <span>CA 状态</span>
        ${filterButton(scope, 'ca', 'all', '全部', filters.ca)}
        ${filterButton(scope, 'ca', 'confirmed', 'CA 已确认', filters.ca)}
        ${filterButton(scope, 'ca', 'review', 'CA 待复核', filters.ca)}
        ${filterButton(scope, 'ca', 'none', '无 CA', filters.ca)}
      </div>
    </div>
  `;
}

function visibilityPanel(scope, filters) {
  if (scope !== 'overview') return '';
  return `
    <div class="filter-panel" data-filter-scope="${scope}">
      <div class="filter-group">
        <span>显示</span>
        ${filterButton(scope, 'visibility', 'active', '活跃', filters.visibility)}
        ${filterButton(scope, 'visibility', 'hidden', '已隐藏', filters.visibility)}
        ${filterButton(scope, 'visibility', 'all', '全部', filters.visibility)}
      </div>
    </div>
  `;
}

function filterButton(scope, type, value, label, activeValue) {
  return `<button class="filter-button ${activeValue === value ? 'active' : ''}" data-filter-scope="${scope}" data-filter-type="${type}" data-filter-value="${value}">${label}</button>`;
}

function bindFilterPanel(root, scope) {
  root.querySelectorAll(`[data-filter-scope="${scope}"][data-filter-type]`).forEach((button) => {
    button.addEventListener('click', () => {
      const target = scope === 'batch' ? state.batchFilters : state.overviewFilters;
      target[button.dataset.filterType] = button.dataset.filterValue;
      if (scope === 'batch') renderBatch(state.currentBatch);
      else renderProjectOverview();
    });
  });
}

function applyProjectFilters(projects, filters) {
  return projects.filter((project) => {
    const visibility = filters.visibility || 'all';
    const hidden = isHiddenProject(project);
    const visibilityMatch =
      visibility === 'all' ||
      (visibility === 'hidden' ? hidden : !hidden);
    const tokenMatch = filters.token === 'all' || tokenCategory(project) === filters.token;
    const caMatch = filters.ca === 'all' || caCategory(project) === filters.ca;
    return visibilityMatch && tokenMatch && caMatch;
  });
}

function renderHistory() {
  if (!state.batches.length) {
    els.historyList.innerHTML = '<div class="empty-state">暂无历史报告。</div>';
    return;
  }
  els.historyList.innerHTML = state.batches.map(historyItem).join('');
  bindOpenButtons(els.historyList);
}

function renderDuplicateNotice() {
  if (!els.duplicateNotice) return;
  const rows = parseInputRows(els.rawInput.value);
  const duplicates = rows.filter((row) => projectHandleSet().has(row.key));
  const hiddenMatches = rows.filter(
    (row) => !projectHandleSet().has(row.key) && hiddenProjectHandleSet().has(row.key)
  );
  if (!duplicates.length && !hiddenMatches.length) {
    els.duplicateNotice.hidden = true;
    els.forceStartButton.hidden = true;
    els.startButton.textContent = '开始分析';
    return;
  }
  const uniqueDuplicates = [...new Map(duplicates.map((row) => [row.key, row.handle])).values()];
  const uniqueHiddenMatches = [...new Map(hiddenMatches.map((row) => [row.key, row.handle])).values()];
  els.duplicateNotice.hidden = false;
  els.forceStartButton.hidden = !uniqueDuplicates.length;
  els.startButton.textContent = uniqueDuplicates.length ? '跳过重复并分析' : '开始分析';
  els.duplicateNotice.innerHTML = `
    <strong>发现已存在项目</strong>
    ${uniqueDuplicates.length ? `<p>以下账号已在项目汇总中存在：${uniqueDuplicates.map((handle) => `<span class="mono">${escapeHtml(handle)}</span>`).join('、')}</p>` : ''}
    ${uniqueDuplicates.length ? '<p>默认会跳过重复账号，只分析新账号；如需更新旧数据，请点击“仍然重新分析全部”。</p>' : ''}
    ${uniqueHiddenMatches.length ? `<p>以下账号当前已隐藏，本次会作为新任务重新分析并回到活跃视图：${uniqueHiddenMatches.map((handle) => `<span class="mono">${escapeHtml(handle)}</span>`).join('、')}</p>` : ''}
  `;
}

function removeDuplicateInputRows(rawInput) {
  const existing = projectHandleSet();
  return String(rawInput || '')
    .split(/\r?\n/)
    .filter((line) => {
      const row = parseInputRows(line)[0];
      return !row || !existing.has(row.key);
    })
    .join('\n');
}

function projectHandleSet() {
  return new Set(
    state.projects
      .filter((project) => !isHiddenProject(project))
      .map((project) => normalizeHandle(project.x_handle))
      .filter(Boolean)
  );
}

function hiddenProjectHandleSet() {
  return new Set(
    state.projects
      .filter(isHiddenProject)
      .map((project) => normalizeHandle(project.x_handle))
      .filter(Boolean)
  );
}

function parseInputRows(rawInput) {
  return String(rawInput || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const first = line.includes('|') ? line.split('|')[0].trim() : line.split('\t')[0].trim();
      const handle = extractHandle(first);
      return handle ? { line, handle, key: normalizeHandle(handle) } : null;
    })
    .filter(Boolean);
}

function historyItem(batch) {
  return `
    <div class="history-item">
      <div>
        <h3>${escapeHtml(batch.name)}</h3>
        <p>${formatDate(batch.created_at)} · ${batch.total} 个账号 · ${statusLabel(batch.status)}</p>
      </div>
      <div>
        <button class="table-button" data-open-batch="${batch.id}">查看</button>
      </div>
    </div>
  `;
}

function bindOpenButtons(root) {
  root.querySelectorAll('[data-open-batch]').forEach((button) => {
    button.addEventListener('click', async () => {
      const result = await getJson(`/api/batches/${button.dataset.openBatch}`);
      state.currentBatch = result.batch;
      renderBatch(state.currentBatch);
      showView('analyze');
      if (isActiveStatus(state.currentBatch.status)) startPolling(state.currentBatch.id);
    });
  });
  root.querySelectorAll('[data-open-project]').forEach((button) => {
    button.addEventListener('click', async () => {
      const result = await getJson(`/api/batches/${button.dataset.openProject}`);
      state.currentBatch = result.batch;
      renderBatch(state.currentBatch);
      showView('analyze');
      const target = document.querySelector(`#project-${cssEscape(button.dataset.projectId)}`);
      if (target) {
        target.open = true;
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      if (isActiveStatus(state.currentBatch.status)) startPolling(state.currentBatch.id);
    });
  });
}

function decorateVisibilityButtons(root) {
  const projects = filteredOverviewProjects();
  const rows = root.querySelectorAll('tbody tr');
  rows.forEach((row, index) => {
    const project = projects[index];
    if (!project) return;
    const actionCell = row.querySelector('td:last-child');
    if (!actionCell || actionCell.querySelector('[data-toggle-visibility]')) return;
    const button = document.createElement('button');
    button.className = 'table-button';
    button.dataset.toggleVisibility = project.x_handle;
    button.dataset.visibility = isHiddenProject(project) ? 'active' : 'hidden';
    button.textContent = isHiddenProject(project) ? '恢复' : '隐藏';
    actionCell.appendChild(button);
    if (isHiddenProject(project)) {
      const note = document.createElement('div');
      note.className = 'muted small-text';
      note.textContent = '已隐藏';
      actionCell.appendChild(note);
      row.classList.add('is-hidden');
    }
  });
  root.querySelectorAll('[data-toggle-visibility]').forEach((button) => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      await postJson(`/api/projects/${encodeURIComponent(button.dataset.toggleVisibility)}/visibility`, {
        visibility: button.dataset.visibility
      });
      await refreshAll();
    });
  });
}

function renderBatch(batch) {
  if (!batch) {
    els.activeBatch.innerHTML = '';
    return;
  }

  const totalDone = Number(batch.completed || 0) + Number(batch.failed || 0);
  const progress = batch.total ? Math.round((totalDone / batch.total) * 100) : 0;
  const completed = ['completed', 'completed_with_errors'].includes(batch.status);
  const projects = [...(batch.projects || [])].sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  const filteredProjects = applyProjectFilters(projects, state.batchFilters);

  els.activeBatch.innerHTML = `
    <div class="batch-panel">
      <div class="batch-top">
        <div>
          <h3>${escapeHtml(batch.name)}</h3>
          <p>${formatDate(batch.created_at)} · 计划 API 请求 ${batch.api_calls_planned} 次 · ${batch.completed}/${batch.total} 完成</p>
        </div>
        <div>
          <span class="status-pill ${statusClass(batch.status)}">${statusLabel(batch.status)}</span>
          ${completed ? `<a class="table-button" href="/api/batches/${batch.id}/markdown">导出 Markdown</a>` : ''}
        </div>
      </div>
      <div class="batch-body">
        <div class="progress"><div style="width:${progress}%"></div></div>
        ${batch.summary?.overview ? `<p class="summary-text">${escapeHtml(batch.summary.overview)}</p>` : ''}
        ${batch.error ? `<div class="error-box">${escapeHtml(batch.error)}</div>` : ''}
        ${projectTable(filteredProjects, projects.length)}
        ${projectDetails(filteredProjects)}
      </div>
    </div>
  `;
  bindFilterPanel(els.activeBatch, 'batch');
}

function projectTable(projects, totalCount = projects.length) {
  if (!totalCount) return '<div class="empty-state">项目正在排队。</div>';
  return `
    <div class="section-head compact-head">
      <div>
        <h3>项目列表</h3>
        <p>当前显示 ${projects.length} / ${totalCount} 个项目，可按发币状态和 CA 状态叠加筛选。</p>
      </div>
      ${filterPanel('batch', state.batchFilters)}
    </div>
    ${projects.length ? `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>项目</th>
            <th>X账号</th>
            <th>发币状态</th>
            <th>CA</th>
            <th>TGE</th>
            <th>空投</th>
            <th>质量分</th>
            <th>等级</th>
            <th>风险</th>
          </tr>
        </thead>
        <tbody>
          ${projects.map(projectRow).join('')}
        </tbody>
      </table>
    </div>
    ` : '<div class="empty-state">当前筛选条件下暂无项目。</div>'}
  `;
}

function projectRow(project) {
  return `
    <tr>
      <td>${escapeHtml(project.project_name || project.x_handle)}</td>
      <td class="mono">${xLink(project.x_handle)}</td>
      <td>${tokenBadge(project)}</td>
      <td>${caBadge(project)}</td>
      <td>${escapeHtml(project.tge_status || '-')}<br><span class="muted">${escapeHtml(project.tge_time || '')}</span></td>
      <td>${escapeHtml(project.airdrop_status || '-')}</td>
      <td>${project.score ?? '-'}</td>
      <td>${project.grade ? `<span class="grade ${project.grade.toLowerCase()}">${project.grade}</span>` : '-'}</td>
      <td>${project.risk_level ? `<span class="risk ${riskClass(project.risk_level)}">${escapeHtml(project.risk_level)}</span>` : '-'}</td>
    </tr>
  `;
}

function projectDetails(projects) {
  if (!projects.length) return '';
  return `
    <div class="project-list">
      ${projects.map((project) => `
        <details id="project-${escapeAttr(project.id)}">
          <summary>${escapeHtml(project.project_name || project.x_handle)} / ${xLink(project.x_handle)}</summary>
          <div class="project-detail">
            ${project.error ? `<div class="error-box">${escapeHtml(project.error)}</div>` : ''}
            ${project.final?.project_intro ? `<h4>项目简介</h4><p>${escapeHtml(project.final.project_intro)}</p>` : ''}
            ${renderAddressBlocks(project)}
            <p>${escapeHtml(project.summary || '暂无总结')}</p>
            ${renderFinal(project.final)}
          </div>
        </details>
      `).join('')}
    </div>
  `;
}

function renderFinal(final) {
  if (!final) return '';
  return `
    <h4>核心判断</h4>
    ${renderList(final.key_points)}
    <h4>风险点</h4>
    ${renderList(final.risks)}
    <h4>下一步行动</h4>
    ${renderList(final.next_actions)}
    <h4>证据</h4>
    ${renderEvidence(final.evidence)}
  `;
}

function renderAddressBlocks(project) {
  const confirmedCas = firstNonEmptyAddressList(project.final?.confirmed_cas, project.grok_raw?.confirmed_cas);
  const candidateCas = firstNonEmptyAddressList(project.final?.candidate_cas, project.grok_raw?.candidate_cas);
  const wallets = firstNonEmptyAddressList(project.final?.wallet_addresses, project.grok_raw?.wallet_addresses);
  const confirmed = project.ca || project.final?.ca || '';
  return `
    <h4>地址识别</h4>
    <div class="address-grid">
      <div>
        <strong>确认 CA</strong>
        ${confirmedCas.length ? renderAddressList(confirmedCas) : `<p class="mono">${escapeHtml(confirmed || '未确认')}</p>`}
      </div>
      <div>
        <strong>候选 CA</strong>
        ${renderAddressList(candidateCas)}
      </div>
      <div>
        <strong>钱包/金库地址</strong>
        ${renderAddressList(wallets)}
      </div>
    </div>
  `;
}

function addressSummary(project) {
  const confirmedCount = firstNonEmptyAddressList(project.confirmed_cas, project.final?.confirmed_cas, project.grok_raw?.confirmed_cas).length;
  const candidateCount = firstNonEmptyAddressList(project.candidate_cas, project.final?.candidate_cas, project.grok_raw?.candidate_cas).length;
  const walletCount = firstNonEmptyAddressList(project.wallet_addresses, project.final?.wallet_addresses, project.grok_raw?.wallet_addresses).length;
  if (confirmedCount <= 1 && !candidateCount && !walletCount) return '<span class="muted">暂无</span>';
  return [
    confirmedCount > 1 ? `确认 ${confirmedCount}` : '',
    candidateCount ? `候选 ${candidateCount}` : '',
    walletCount ? `钱包 ${walletCount}` : ''
  ].filter(Boolean).map(escapeHtml).join('<br>');
}

function renderAddressList(items) {
  const normalized = normalizeAddressList(items);
  if (!normalized.length) return '<p class="muted">暂无</p>';
  return `
    <ul class="address-list">
      ${normalized.map((item) => `
        <li>
          <span class="mono">${escapeHtml(item.address || item)}</span>
          ${item.label || item.chain || item.source || item.confidence
            ? `<br><span class="muted">${escapeHtml([item.label || item.chain, item.source, item.confidence].filter(Boolean).join(' · '))}</span>`
            : ''}
        </li>
      `).join('')}
    </ul>
  `;
}

function renderList(items) {
  const normalized = normalizeList(items);
  if (!normalized.length) return '<p class="muted">暂无</p>';
  return `<ul>${normalized.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function renderEvidence(items) {
  const normalized = normalizeList(items);
  if (!normalized.length) return '<p class="muted">暂无</p>';
  return `
    <ul>
      ${normalized.map((item) => `
        <li>
          ${escapeHtml(typeof item === 'string' ? item : item.claim || '-')}
          ${item.source_url ? ` · <a href="${escapeAttr(item.source_url)}" target="_blank" rel="noreferrer">来源</a>` : ''}
          ${item.confidence ? ` · ${escapeHtml(item.confidence)}` : ''}
        </li>
      `).join('')}
    </ul>
  `;
}

function xLink(handle) {
  const clean = String(handle || '').trim().replace(/^@/, '');
  if (!clean) return '-';
  return `<a href="https://x.com/${escapeAttr(clean)}" rel="noreferrer" data-open-x="${escapeAttr(clean)}" title="用默认浏览器打开 X 账号 @${escapeAttr(clean)}">@${escapeHtml(clean)}</a>`;
}

async function openXInDefaultBrowser(event) {
  const link = event.target.closest?.('[data-open-x]');
  if (!link) return;
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  const handle = link.dataset.openX;
  try {
    const response = await fetch('/api/open-x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle })
    });
    if (!response.ok) throw new Error('open failed');
  } catch {
    window.location.href = link.href;
  }
}

function extractHandle(input) {
  const trimmed = String(input ?? '').trim();
  const urlMatch = trimmed.match(/(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{1,20})/i);
  const raw = urlMatch ? urlMatch[1] : trimmed.replace(/^@/, '');
  const match = raw.match(/[A-Za-z0-9_]{1,20}/);
  return match ? `@${match[0]}` : '';
}

function normalizeHandle(handle) {
  return String(handle || '').trim().replace(/^@/, '').toLowerCase();
}

function cssEscape(value) {
  if (window.CSS?.escape) return window.CSS.escape(value);
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

function normalizeList(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (!value) return [];
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  return [value];
}

function normalizeAddressList(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (!value) return [];
  if (typeof value === 'string') return value.trim() ? [{ address: value.trim() }] : [];
  return [value];
}

function firstNonEmptyAddressList(...values) {
  for (const value of values) {
    const list = normalizeAddressList(value);
    if (list.length) return list;
  }
  return [];
}

function renderError(message) {
  els.activeBatch.innerHTML = `<div class="error-box">${escapeHtml(message)}</div>`;
}

async function getJson(url) {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function statusLabel(status) {
  const map = {
    queued: '排队中',
    running: 'Grok 检索中',
    finalizing: '生成汇总报告',
    completed: '已完成',
    completed_with_errors: '完成但有失败',
    failed: '失败',
    grok_running: 'Grok 检索中',
    grok_done: '待生成报告'
  };
  return map[status] || status || '-';
}

function statusClass(status) {
  if (String(status).includes('failed')) return 'failed';
  if (['running', 'queued', 'finalizing'].includes(status)) return status;
  return '';
}

function riskClass(risk) {
  if (risk === '高') return 'high';
  if (risk === '中') return 'medium';
  return 'low';
}

function formatDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#096;');
}
