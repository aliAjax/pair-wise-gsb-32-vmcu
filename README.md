# TripWeaver 旅游行程规划助手

## 快速启动

```bash
pnpm install
pnpm dev
```

访问地址：http://localhost:18417

逻辑自测（离线分段批次合并的 32 项断言）：

```bash
pnpm test:logic
```

TripWeaver 是一款纯前端旅行规划应用，支持创建旅行、探索景点、编排每日行程、预算统计和分享预览。

## 主要功能

- 我的旅行：创建、筛选、删除旅行计划。
- 行程详情：查看每日行程、预算图表和共享时间线。
- 景点探索：按 SpotCategory 搜索和筛选，收藏并加入行程。
- 行程编排：SortableJS 拖拽排序，实时影响预算计算。
- 分享预览：生成可复制的行程文本，并可只读查看历史合并结果。
- **离线分段批次合并（`/sync`）**：模拟山区徒步队分头离线改同一行程、回信号后合并：
  - 旅行计划 / 每日安排 / 景点引用都是**只追加事件流**，每条改动带**成员、时刻、出发前版本（baseVersion）和分段天**。
  - **分段批次**：批次只负责指定的天，不同分段直接拼接接上，不覆盖别段。
  - **同一天同一景点被两人动过**：出发前原版 + 每人版本**并列保留**，队长单选选定；选定前**不计入预算和分享**。预算 / 同行人 / 日期被两人同改同理并列。
  - **中断续传**：批次重放以 `appliedCount` 为水位，中断后从上次完整结果继续；事件溯源投影保证重放同批幂等，不多出安排、不重复生成快照。
  - **景点停业 / 价格变化**：登记后相关日期标记"失效待确认"，确认前不计入预算/分享，确认后（停业撤下、调价按新价）重新计入；价格调整更新景点目录，但每个完整批次的**快照自带当时价格表，旧结果仍可查看、金额可复现**。

## 技术栈

| 分类 | 技术 |
| --- | --- |
| 前端 | Vue 3 + TypeScript |
| 构建 | Vite |
| UI | Element Plus + ECharts |
| 状态 | Pinia |
| 路由 | Vue Router 4 |
| 持久化 | localStorage + Dexie.js |
| 交互 | sortablejs |

## 目录结构

```
src/
├── api/              # tripApi.ts, spotApi.ts, dayPlanApi.ts, syncApi.ts（事件/批次/选定/变化/快照）
├── stores/           # tripStore.ts, spotStore.ts, dayPlanStore.ts, themeStore.ts, syncStore.ts
├── models/           # trip.ts, spot.ts, dayPlan.ts, change.ts（离线事件）, sync.ts（批次/选定/变化/快照）
├── types/
├── components/common/# TripCard, SpotCard, DayTimeline, MergedDayTimeline, CategoryFilter, SpotMiniCard, BudgetChart, TripHeader, EmptyState
├── hooks/            # useTripStats.ts, useLocalStorage.ts, useMapSpots.ts, useMergedPlan.ts
├── pages/            # Trips, TripDetail, Spots, Planner, Share, SyncCenter（离线分段批次合并台）
├── router/           # index.ts + guards.ts
├── utils/            # storage.ts, budgetCalculator.ts, formatters.ts, validators.ts, syncReducer.ts, syncSnapshot.ts
├── constants/        # spot.ts, trip.ts, sync.ts, themes.ts, messages.ts, storageVersion.ts
scripts/
└── sync.test.ts      # 离线合并 32 项端到端逻辑断言（pnpm test:logic）
```

## 数据持久化

本地数据通过 `utils/storage.ts` 统一写入 localStorage，并保留 Dexie 数据库对象用于后续 IndexedDB 扩展（v2 已声明 syncChanges / syncBatches / syncSnapshots 表）。版本键来自 `constants/storageVersion.ts`。

离线同步数据（事件流、批次、队长选定、景点变化、历史快照）各占一个独立 localStorage 键，经 `api/syncApi.ts` 存取；合并结果不落库，由 `utils/syncReducer.ts` 从事件流现场投影，保证可重放、可复现。

## 离线分段批次合并：模型与规则

| 概念 | 文件 | 说明 |
| --- | --- | --- |
| TripChange（离线改动事件） | `models/change.ts` | 携带成员、时刻、baseVersion、分段天；op=upsert/remove，target=trip/item |
| SyncBatch（分段批次） | `models/sync.ts` | segmentDays 分段、baseVersion、status、appliedCount 中断水位 |
| LeaderDecision（队长选定） | `models/sync.ts` | 冲突键 → 选中的事件（可选出发前原版） |
| SpotRevision（景点变化） | `models/sync.ts` | 停业/调价、受影响日期、逐天确认记录 |
| SyncSnapshot（历史结果） | `models/sync.ts` | 批次完成时固化行程副本 + 当时价格表 |
| 投影器 | `utils/syncReducer.ts` | 纯函数：基线 + 已重放事件 → 生效行程；并列、失效、分享文本 |
| 快照 / 预算 | `utils/syncSnapshot.ts`、`utils/budgetCalculator.ts` | 快照构造与旧价复现；pending/invalid 项不计入 |
| 状态中枢 | `stores/syncStore.ts`、`api/syncApi.ts` | 建批、记录改动、按水位重放、选定、登记变化 |
| 页面与组件 | `pages/SyncCenter.vue`、`pages/Share.vue`、`components/common/MergedDayTimeline.vue`、`hooks/useMergedPlan.ts` | 合并台、分享口径、并列时间线、投影 hook |

冲突键规则：行程项为 `` `${dayIndex}:${spotId}` ``，行程字段为 `field:${field}`。每个冲突键下按成员取其最新一条；动过的成员 ≥ 2 即进入并列（含删除候选），队长选定前预算与分享都排除这些项。

## 枚举出现位置清单

SpotCategory：
- `src/constants/spot.ts`
- `src/models/spot.ts`
- `src/stores/spotStore.ts`
- `src/components/common/CategoryFilter.vue`
- `src/components/common/SpotCard.vue`
- `src/pages/Spots.vue`
- `src/pages/TripDetail.vue`
- `src/utils/formatters.ts`
- `src/router/guards.ts`

TripStatus：
- `src/constants/trip.ts`
- `src/models/trip.ts`
- `src/stores/tripStore.ts`
- `src/components/common/TripCard.vue`
- `src/pages/Trips.vue`
- `src/utils/formatters.ts`
- `src/router/guards.ts`

离线同步枚举组（`ChangeOp` / `ChangeTarget` / `BatchStatus` / `VariantStatus` / `SpotChangeKind`，定义于 `src/constants/sync.ts`）：
- `src/constants/sync.ts`
- `src/models/change.ts`
- `src/models/sync.ts`
- `src/api/syncApi.ts`
- `src/stores/syncStore.ts`
- `src/utils/syncReducer.ts`
- `src/utils/syncSnapshot.ts`
- `src/utils/budgetCalculator.ts`
- `src/utils/formatters.ts`
- `src/constants/messages.ts`
- `src/hooks/useMergedPlan.ts`
- `src/components/common/MergedDayTimeline.vue`
- `src/pages/SyncCenter.vue`
- `src/pages/Share.vue`
- `scripts/sync.test.ts`

## 环境变量

`VITE_AMAP_KEY`：高德地图 key。未配置时使用 demo-key，地图主题配置同时出现在 `config/map.ts`、`SpotCard`、`DayTimeline`、`Planner` 相关逻辑中。

## License

MIT

