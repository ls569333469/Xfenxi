# X Token Opportunity Analyzer 项目进度

更新时间：2026-05-18

## 1. 当前阶段

当前进入本地个人工具完整落地阶段，不再按最小 MVP 边界推进。当前重点是把真实投研使用中已经暴露的问题全部落到产品和代码里，包括总览去重、输入查重、发币状态高亮、三阶段投研、模型切换、报告质量和后续多数据源校验。

阶段目标：

- 保持本地页面可用，并支持后续个人服务器自用部署。
- 用真实 API 样本持续校验 Grok + GPT / Claude 的报告质量。
- 将 CA、候选 CA、钱包地址、发币状态、项目简介、质量评价拆成清晰字段。
- 让项目总览成为跨批次唯一主表，历史批次作为审计记录保留。
- 后续接入官网、docs、链上浏览器、CoinGecko / CMC 等数据源做二次校验。

## 2. 已完成

| 项目 | 状态 | 说明 |
|---|---|---|
| 项目设计文档 | 已完成初版 | `docs/PROJECT_DESIGN.md` |
| `.env` 文件 | 已建立 | 当前 `MOCK_LLM=false`，Grok / GPT / Claude key 已填 |
| 本地服务 | 已运行 | `http://localhost:3000` 可访问，当前为 real 模式 |
| 页面打开 | 已验证 | 页面中文显示正常，运行配置展示正常 |
| Mock 批次测试 | 已通过 | 批次 `MVP Mock 页面验收`，3 个 X 账号全部完成 |
| Markdown 导出 | 已验证 | 报告结构完整，可通过 `/api/batches/:id/markdown` 获取 |
| 静态语法检查 | 已通过 | `npm run check` 和 `node --check public/app.js` 已通过 |
| 真实 API smoke test | 已通过 | 单账号 `@monad_xyz` 跑通 Grok + GPT 汇总链路 |
| 总览项目表 | 已实现 | `/api/projects` 汇总所有历史项目，Dashboard 展示跨批次项目表 |
| 项目简介 | 已接入 | 新报告要求模型返回 `project_intro`，历史数据用 summary 兜底 |
| TXT 上传入口 | 已移除 | 当前按直接粘贴账号列表使用 |
| 冗余与潜在 bug 检查 | 已完成 | 修复统计口径、历史项目简介兜底、数组/字符串展示兼容 |
| 总览投研跳转 | 已完成 | 总览表移除批次列，新增“查看投研”按钮，可跳到对应项目详情 |
| X 账号外链 | 已完成 | 表格和详情中的 X 账号可跳转到对应 X 页面 |
| GPT / Claude 切换 | 已完成 | 分析页新增“汇总模型”选择，GPT 与 Claude 汇总链路均已 smoke test |
| Grok 请求重试 | 已完成 | 外部 API fetch 失败会自动重试，降低偶发网络失败影响 |
| 地址三分类 | 已完成 | 区分确认 CA、候选 CA、钱包 / 金库地址，并在总览和投研详情展示 |
| 设计文档同步 | 已完成 | 更新本地个人工具定位、GPT/Claude 切换、总览表、地址识别、未完成项 |
| 三阶段审计 | 已完成最小版 | 分析页可选 Fast / Deep / Verify；分别对应 1 / 2 / 3 轮 Grok，再统一 GPT/Claude 汇总 |
| 深度重跑复盘 | 已完成 | 13 个真实项目深度审计结果、问题和后续优先级见 `docs/PROJECT_REANALYSIS_2026-05-18.md` |
| 项目总览去重 | 已完成 | `/api/projects` 按 X 账号归并，只展示最新有效主记录；旧记录和失败批次默认隐藏 |
| 输入前查重 | 已完成 | 账号列表输入时会提示已存在项目，默认跳过重复账号，可手动强制重新分析全部 |
| 发币/CA 双筛选 | 已完成 | 批次结果页和项目总览页均支持发币状态、CA 状态叠加筛选 |

## 3. 当前测试记录

### 3.1 Mock 页面测试

测试批次：

```text
MVP Mock 页面验收
```

测试输入：

```text
@monad_xyz | Monad | https://monad.xyz | Monad | 重点看 TGE
@berachain | Berachain | https://berachain.com | Berachain | 关注代币和空投
@eclipsefnd | Eclipse | https://eclipse.xyz | Ethereum/Solana | 观察是否发币
```

测试结果：

| 指标 | 结果 |
|---|---:|
| 项目数 | 3 |
| 完成数 | 3 |
| 失败数 | 0 |
| 计划 API 请求数 | 4 |
| 模式 | Mock 演示 |

报告观察：

- 页面能显示批次状态、进度、项目排序表和项目详情。
- Markdown 报告包含总览、机会排序表、重点机会、人工确认列表和独立项目报告。
- Mock 报告仅用于验证流程和展示结构，不代表真实投研结果。

### 3.2 真实 API Smoke Test

测试批次：

```text
真实 API Smoke Test - Monad
```

说明：本次通过 PowerShell API 提交时，中文批次名在终端编码中显示为 `?? API Smoke Test - Monad`，不影响 API 链路判断。

测试输入：

```text
@monad_xyz | Monad | https://monad.xyz | Monad | 真实 API 联调
```

测试结果：

| 指标 | 结果 |
|---|---:|
| 项目数 | 1 |
| 完成数 | 1 |
| 失败数 | 0 |
| 计划 API 请求数 | 2 |
| 模式 | Real |

报告观察：

- Grok 阶段完成，并进入汇总生成阶段。
- GPT 汇总完成，批次最终状态为 `completed`。
- 报告能识别 `@monad_xyz` 已迁移到 `@monad`，并建议人工复核新官方账号。
- 报告未臆造 CA、TGE 或空投结论，整体符合“证据不足时保守输出”的原则。

## 4. 未完成 / 阻塞项

| 项目 | 状态 | 阻塞原因 |
|---|---|---|
| Grok 真实 API 联调 | 进行中 | 已跑 Monad、Fair、PokerFi、Clash、Pitch、Meta Captain、HydrexFi 等样本 |
| GPT 真实 API 联调 | 进行中 | 已跑单账号和多账号样本，仍需评估报告稳定性 |
| Claude 方案 | 已完成最小版 | 当前作为 GPT 汇总模型的可选替代项，已 smoke test |
| 真实报告质量评估 | 进行中 | 已有 Monad、Fair、PokerFi、Clash of Perps 等样本 |
| 多数据源接入 | 未开始 | 下一步要加入官网、docs、链上浏览器、CoinGecko / CMC |
| 个人服务器部署 | 未开始 | 本地功能稳定后设计自用部署与访问保护 |
| 分级分析模式 | 已实现最小版 | 仍需真实样本评估质量提升是否值得增加 API 成本 |
| 评分体系重构 | 未实现 | CA 作为事实判断，质量分 / 资本背书 / 风险后续拆分 |

## 5. 下一步建议

### P0

- 继续积累不同类型项目的真实 API 报告样本。
- 用真实样本对比 Fast / Deep / Verify 的报告质量、CA 识别准确率和耗时成本。
- 明确评分体系重构方案；当前更倾向于事实状态和项目质量分拆开。
- 接入官网、docs、链上浏览器、CoinGecko / CMC，校验 X 搜索返回的 CA 和发币状态。

### P1

- 根据真实报告结果调整 Grok prompt 和 GPT / Claude 汇总 prompt。
- 增加真实 API 错误展示、重试策略和调用日志。
- 增加输入解析、Markdown 生成、API 的自动化测试。

### P2

- 接入官网、docs、链上浏览器、CoinGecko / CMC。
- 设计个人服务器部署方式。
- 增加登录保护或访问限制。

## 6. 当前决策

- 产品只做本地个人工具。
- 后续可以部署到个人服务器自用。
- 不做公开 SaaS 或多人协作产品。
- 单批 20 个账号是当前配置限制，不再作为产品目标边界。
- 前期主要依赖 Grok API 的 X 搜索能力。
- 后续增加官网、docs、链上浏览器、CoinGecko / CMC 等数据源。
