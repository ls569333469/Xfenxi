function text(value, fallback = '') {
  return value === undefined || value === null || value === '' ? fallback : String(value);
}

function cell(value) {
  return text(value, '-').replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

function list(items) {
  if (!Array.isArray(items) || items.length === 0) return '- 暂无';
  return items.map((item) => `- ${text(item, '-')}`).join('\n');
}

function addressList(items) {
  if (!Array.isArray(items) || items.length === 0) return '- 暂无';
  return items
    .map((item) => {
      if (typeof item === 'string') return `- ${item}`;
      return `- ${text(item.address, '-')}（${text(item.label || item.chain || item.source, '待确认')}，${text(item.confidence, '置信度未知')}）`;
    })
    .join('\n');
}

function confirmedCas(final) {
  if (Array.isArray(final.confirmed_cas) && final.confirmed_cas.length) return final.confirmed_cas;
  return final.ca ? [{ address: final.ca, confidence: final.ca_confidence }] : [];
}

function evidenceTable(evidence) {
  if (!Array.isArray(evidence) || evidence.length === 0) {
    return '| 结论 | 来源 | 置信度 |\n|---|---|---|\n| 暂无 | - | - |';
  }
  const rows = evidence.map((item) => {
    const source = item.source_url
      ? `[来源](${item.source_url})`
      : text(item.source, '-');
    return `| ${cell(item.claim)} | ${cell(source)} | ${cell(item.confidence)} |`;
  });
  return ['| 结论 | 来源 | 置信度 |', '|---|---|---|', ...rows].join('\n');
}

export function projectMarkdown(project) {
  const final = project.final ?? project;
  return `
### ${text(final.project_name || project.project_name, 'Unknown Project')} / ${text(final.x_handle || project.x_handle)}

#### 机会结论
- 机会等级：${text(final.grade)}
- 质量分：${text(final.score)}
- 是否发币：${text(final.token_status)}
- CA：${text(final.ca, '未确认')}
- CA 置信度：${text(final.ca_confidence, '无')}
- TGE 状态：${text(final.tge_status)}
- 预计 TGE：${text(final.tge_time, '暂无可靠信息')}
- 空投/积分机会：${text(final.airdrop_status)}
- 风险等级：${text(final.risk_level)}

#### 项目简介
${text(final.project_intro, '暂无项目简介')}

#### 地址识别
- 确认 CA：
${addressList(confirmedCas(final))}
- 候选 CA：
${addressList(final.candidate_cas)}
- 钱包/金库地址：
${addressList(final.wallet_addresses)}

#### 核心判断
${text(final.summary, '暂无总结')}

#### 关键点
${list(final.key_points)}

#### 风险点
${list(final.risks)}

#### 下一步行动
${list(final.next_actions)}

#### 来源与证据
${evidenceTable(final.evidence)}
`.trim();
}

export function batchMarkdown(batch, projects, summary) {
  const sorted = [...projects].sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0));
  const tableRows = sorted.map((project, index) => {
    return [
      index + 1,
      project.project_name,
      project.x_handle,
      project.token_status,
      project.ca || '未确认',
      project.ca_confidence || '无',
      project.tge_status,
      project.tge_time || '暂无',
      project.airdrop_status,
      project.score,
      project.grade,
      project.risk_level
    ].map(cell).join(' | ');
  });

  const table = [
    '| 排名 | 项目 | X账号 | 是否发币 | CA | CA置信度 | TGE状态 | 预计TGE | 空投机会 | 质量分 | 等级 | 风险 |',
    '|---|---|---|---|---|---|---|---|---|---:|---|---|',
    ...tableRows.map((row) => `| ${row} |`)
  ].join('\n');

  return `
# 批量空投 / TGE 机会分析报告

## 总览结论
- 批次：${text(batch.name)}
- 分析账号数：${text(batch.total)}
- 高优先级项目：${text(summary?.high_priority_count, 0)}
- 临近 TGE 项目：${text(summary?.near_tge_count, 0)}
- 已发币项目：${text(summary?.issued_count, 0)}
- 需人工确认：${text(summary?.manual_review_count, 0)}
- 生成时间：${new Date().toISOString()}

${text(summary?.overview, '')}

## 机会排序表

${table}

## 重点机会
${list(summary?.top_opportunities)}

## 需要人工确认
${list(summary?.manual_review)}

## 独立项目报告

${sorted.map(projectMarkdown).join('\n\n')}
`.trim();
}
