# 项目汇总重跑复盘

更新时间：2026-05-18

## 1. 本次结论

本次重新跑了 13 个真实 X 项目账号，使用“深度审计”模式。

| 指标 | 结果 |
|---|---:|
| 项目数 | 13 |
| Grok 审计轮数 | 每项目 2 轮 |
| 计划 API 请求 | 27 |
| Grok 完成 | 13 / 13 |
| Grok 失败 | 0 |
| 最终状态 | completed |
| 最终汇总方式 | Grok 深度结果兜底汇总 |

说明：Grok 阶段全部完成；GPT 批量汇总阶段因 `apikey.fun` 返回 524 超时，系统已使用 Grok 深度结果生成兜底总览和项目 final 数据。

## 2. 项目结果排序

排序原则：

1. 已确认 CA 的项目优先。
2. 已发币但 CA 存疑 / 候选地址项目次之。
3. 有项目质量或生态价值，但暂无明确 CA / TGE 的项目随后。
4. 暂无发币、空投或 TGE 线索的项目放后。

### 2.1 已确认 CA

| 排名 | 项目 | X 账号 | 状态 | CA / 地址 | 风险 | 下一步 |
|---:|---|---|---|---|---|---|
| 1 | Fair | `@fair_vc` | 已发币，CA 已确认 | `0x7D928816CC9c462DD7adef911De41535E444CB07` | 低 | 复核 Base 链浏览器、持仓、流动性、权限 |
| 2 | Capacitr | `@capacitr_xyz` | 已发币，CA 已确认 | `0x65F8152809Dd1fC0D5d8A345c9008d37B95f9ba3` | 中 | 复核 CA、fee recipient、LP 和 Bankr 创建记录 |

Capacitr 额外识别到钱包 / 收费地址：

| 地址 | 类型 | 来源 | 置信度 |
|---|---|---|---|
| `0x4569f457f2b2302f2905aa887ca0ef8be5453feb` | fee recipient | bankrbot deployment reply in official thread | 高 |

### 2.2 已发币 / 可能已上线，但 CA 仍需复核

| 排名 | 项目 | X 账号 | 当前判断 | 候选 / 需复核地址 | 风险 | 下一步 |
|---:|---|---|---|---|---|---|
| 3 | Clash of Perps | `@clashofperps` | 已发币但 CA 存疑 | `0xd8Db4C337d09Da8d7ceb7d87ADFE224D17785ba3` | 中 | 该地址来自官方 bio，但未明确标注 CA，需要链上浏览器和官方链接复核 |
| 4 | Eclipse | `@eclipsefnd` | 存在候选地址，需人工复核 | 多链候选地址 | 中 | 区分 token CA、桥地址、系统合约和链基础设施地址 |
| 5 | Berachain | `@berachain` | 已上线 / 已发币迹象，但本轮未确认 CA | 暂无 | 中 | 后续用 CoinGecko / CMC / 官网 / docs 校验 BERA CA |
| 6 | Monad | `@monad` | 主网 / 代币状态有线索，但 CA 未确认 | 暂无 | 低 | 继续监控官方 CA、claim、checker、生态空投规则 |
| 7 | Pitch World Cup | `@Pitch_ERC` | 已发币但 CA 存疑 | 暂无 | 中 | 从官方 App / 官网跳转校验 `$PITCH` 合约 |

Eclipse 本轮候选地址：

| 地址 | 链 | 来源 | 置信度 |
|---|---|---|---|
| `GnBAskb2SQjrLgpTjtgatz4hEugUsYV7XrWU1idV3oqW` | Eclipse Mainnet | X 官方帖 | 高 |
| `0x6055Dc6Ff1077eebe5e6D2BA1a1f53d7Ef8430dE` | Ethereum Mainnet | X 官方帖 | 高 |
| `BqPqrrQuoQXFGGEAEMnPmDgZ6RWQCajWnY3V6Yp4DZWP` | Solana Mainnet | X 官方帖 | 高 |

### 2.3 有项目价值，但暂无明确发币 / CA 机会

| 排名 | 项目 | X 账号 | 项目简介 | 当前判断 | 风险 |
|---:|---|---|---|---|---|
| 8 | Hydrex | `@HydrexFi` | Base 链流动性中心，提供 LP、staking、voting 激励 | 弱暗示发币，暂无 CA | 中 |
| 9 | PokerFi | `@pokerfi_gg` | 将扑克游戏转化为期权市场，backed by YZi Labs | 暂无发币迹象 | 中 |
| 10 | MetaCaptain / MetaLabz | `@Meta_Captain_` | Base 生态 builder / agentic DeFi 工具方向 | 更像个人 / builder 账号，暂无自有发币证据 | 中 |

### 2.4 暂无当前机会，保留观察

| 排名 | 项目 | X 账号 | 当前判断 | 备注 |
|---:|---|---|---|---|
| 11 | Polymarket | `@polymarket` | 暂无自身发币 / TGE / 空投线索 | 平台价值高，但当前不是 TGE 机会 |
| 12 | pump.fun | `@pumpdotfun` | 暂无发币 / TGE / 空投线索 | X 搜索结果不足，需后续多源复核 |
| 13 | aixbt | `@aixbt_agent` | 暂无自身发币迹象 | 更像 AI 市场分析账号，不是明确项目官方账号 |

## 3. 本次发现的问题

### P0 问题

| 问题 | 影响 | 本次处理 |
|---|---|---|
| GPT 批量汇总接口 524 超时 | Grok 已完成但批次卡在 finalizing，项目总览无法稳定落库 | 增加请求超时、重新汇总接口、兜底汇总逻辑 |
| Deep 审计结果过大 | 13 个项目的多轮 Grok 原始文本过长，增加汇总失败概率 | 汇总前压缩 Grok 数据，不再传完整 raw_text 和 audit_rounds 原文 |
| finalizing 状态残留 | 已有 summary 和项目 final 数据，但批次状态仍显示 finalizing | 增加启动时状态修复逻辑 |

### P1 问题

| 问题 | 影响 | 后续建议 |
|---|---|---|
| PowerShell 中文提交乱码 | 批次名 / notes 显示 `????` | 前端提交不受影响；命令行提交中文后续改用 UTF-8 脚本或前端操作 |
| 兜底评分偏保守 | 很多项目为 D/C，不能代表真实项目质量 | 重构评分体系，把 CA 事实、项目质量、资本背书、风险拆开 |
| Grok 对“已发币但 CA 未确认”表达仍不稳定 | 例如 Eclipse / Monad / Berachain 需要人工确认 | 接入官网、docs、链上浏览器、CoinGecko / CMC 后再校验 |

## 4. 本次代码修复

按重要性排序：

1. 增加 GPT / Claude 请求超时，避免外部 API 长时间不返回导致批次永久卡住。
2. 增加 Grok 结果压缩逻辑，最终汇总阶段只传必要字段。
3. 增加兜底汇总：GPT / Claude 批量汇总失败时，使用 Grok 深度结果生成项目 final_json、Markdown 和总览。
4. 增加重新汇总接口：Grok 已完成但汇总失败时，不重跑 Grok，直接重新 finalizing。
5. 增加 finalizing 状态修复：已有 summary 的批次启动时自动修正为 completed。

## 5. 当前可用结论

### 可直接进入二次人工复核

| 项目 | 原因 |
|---|---|
| Fair | 官方 X bio 直接给 CA，风险较低，适合链上二次核验 |
| Capacitr | CA 和 fee recipient 均被识别，适合查 Bankr、LP、权限、持仓分布 |
| Clash of Perps | 有候选地址但角色不明，适合验证是否 token CA |
| Eclipse | 多链候选地址需要判断是 token、桥、系统合约还是其他地址 |

### 暂时只观察

| 项目 | 原因 |
|---|---|
| Hydrex | 产品存在，但 CA / TGE 证据不够 |
| PokerFi | 有 backing 信号，但暂无发币 / TGE |
| MetaCaptain / MetaLabz | 更像个人 builder / 早期项目标签 |
| Monad | 需继续监控官方 CA / claim / checker |
| Berachain | 需用外部数据源校验官方 CA |
| Pitch World Cup | 已有 `$PITCH` 叙事，但 CA 未确认 |
| Polymarket | 当前无自身发币机会 |
| pump.fun | 当前 X 搜索证据不足 |
| aixbt | 更像分析账号，不是明确项目官方发币机会 |

## 6. 下一步优先级

### P0

1. 接入链上浏览器 / CoinGecko / CMC，优先校验已发币项目 CA。
2. 重构评分体系：CA 是事实字段，项目质量、资本背书、风险单独评分。
3. 给总览页增加“只看最新批次 / 隐藏 mock / 隐藏失败批次”筛选，避免旧数据干扰。

### P1

1. 增加单项目“二次复核”按钮，不必每次重跑整批。
2. 增加 API 调用日志和成本统计。
3. 增加批次取消、重跑失败项目、重新汇总按钮。

### P2

1. 设计个人服务器部署和访问保护。
2. 增加自动化测试，覆盖输入解析、模型输出解析、Markdown、状态恢复。
3. 逐步接入官网、docs、链上浏览器、CoinGecko / CMC 等多源数据。
