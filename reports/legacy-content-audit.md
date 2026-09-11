# `data/game-content/legacy/zh-hans` 与 `data/` 内容审计报告

- 审计时间：2026-09-11T12:25:24Z
- 审计范围：`data/game-content/legacy/zh-hans/*.json` 与 `data/` 中排除 `data/game-content/legacy/`、`data/game-content/legacy-content-index.json` 后的 JSON/canonical 数据
- 审计性质：先完成只读盘点，随后完成 canonical 去重/迁移并删除 legacy 内容包
- 结论：旧数据已经被复制或拆分到 canonical 数据；本次已收敛重复 owner、改造探针/离线工具并删除整个 `data/game-content/`。工作/社交蓝图、HIS 自定义界面、日历/时间规则、全局变量等仍需继续做行为和存档闭环验证，但不再依赖仓库内 legacy 内容包

## 1. 总量盘点

| 项目 | 数量 | 说明 |
| --- | ---: | --- |
| 删除前 legacy JSON 文件 | 54 | 删除前与 preservation index 的 `counts.json=54` 一致 |
| legacy JSON 蓝图 | 106 | 2,315 个节点、2,129 条连线 |
| canonical JSON 文件 | 229 | 排除 legacy 保留镜像和索引；已移除两个重复副本 |
| `data/activities/*.json` | 163 | 163 个 canonical Activity 定义；2,827 个节点、2,524 条连线 |
| legacy 顶层记录 | 1,093 | 只统计顶层数组中的带稳定 `id` 记录 |
| 与 canonical 同 ID 且完整 JSON 相同 | 926 | 可视为内容已复制，但不等于运行时已验证 |
| 与 canonical 同 ID 但字段已变换 | 159 | 需要检查拆分、补字段、Activity 映射和行为等价性 |
| legacy 顶层记录未在 canonical 中找到同 ID | 8 | 全部来自 `app_his_custom.json` 的旧 widget ID；大概率已转为窗口/Widget 结构，但不能仅凭 ID 判定完成 |

> 记录级统计按稳定 ID 比较；工作/社交蓝图经迁移后通常改为 `data/activities/` 中的 Activity ID，因此“同 ID 已变换”不是缺失证明。

## 2. 已发现的直接重复内容

### 2.1 文件级 byte-identical 重复

以下 legacy 文件与 canonical 文件 SHA-256 完全相同：

| legacy | canonical |
| --- | --- |
| `item_placements.json` | `data/item-placements.json` |
| `keywords.json` | `data/databases/keywords.json` |
| `locations.json` | `data/databases/locations.json` |
| `npcs.json` | `data/databases/npcs.json` |

这些文件的 legacy 镜像可以作为迁移保留资料，但不能再作为运行时来源；运行时应继续只通过 `data/game-manifest.json` 的 canonical 路径加载。

### 2.2 文件级 normalized-JSON 重复

除上述 4 个文件外，下列文件与 canonical 内容在忽略 JSON 排版后相同：

| legacy | canonical |
| --- | --- |
| `skills.json` | `data/databases/skills.json` |
| `turtle_soups.json` | `data/databases/turtleSoupPuzzles.json` |

`turtle_soups.json` 原先存在两个 canonical 副本；本次已将 `data/databases/turtleSoupPuzzles.json` 定为唯一 authoritative owner，并移除未被运行时使用的 native 副本及其 manifest/data-files 注册。

### 2.3 legacy 内部 normalized-JSON 重复

以下 legacy 文件彼此内容相同：

- `maininit.json`、`mainpub.json`
- `work01b.json`、`work02b.json`、`work03b.json`、`work04b.json`、`work05a.json`、`work05b.json`、`work06b.json`

其中工作文件是空 `entries` 或等价空壳时，可以在迁移报告中标记为历史占位；删除前仍需确认它们没有承担原引擎日期/分支占位语义，不能因为文件内容相同就合并成一个业务记录。

## 3. 按领域的重复与迁移状态

| legacy 文件/领域 | legacy 顶层记录 | 完整相同 | 同 ID 但已变换 | 未找到同 ID | 现有 canonical 对应物 | 审计判断 |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| `achievements.json` | 26 | 22 | 4 | 0 | `databases/achievements.json` | 已迁移，4 条需要核对字段差异 |
| `app_his_custom.json` | 9 | 0 | 1 | 8 | `app-definitions.json`、`windows/his.json` | 部分迁移；旧 widget/blueprint 行为需闭环 |
| `applist.json` | 1 | 1 | 0 | 0 | `app-definitions.json` | 已复制 |
| `bgm.json` | 37 | 37 | 0 | 0 | `media.json` | 已复制 |
| `cg.json` | 31 | 31 | 0 | 0 | `media.json` | 已复制；仍需资源显示路径验证 |
| `diagnoses.json` | 14 | 0 | 14 | 0 | `databases/diagnosisCategories.json`、`databases/diagnoses.json` | 已拆分/规范化；需核对诊断记录全集 |
| `endings.json` | 15 | 0 | 15 | 0 | `databases/endings.json`、`activities/ending__*.json` | 已拆分为数据库 + Activity；需核对每个结局入口和效果 |
| `items.json` | 29 | 19 | 10 | 0 | `databases/inventoryItems.json` | 已迁移；10 条有 canonical 字段变化，需核对使用 Activity |
| `keywords.json` | 645 | 645 | 0 | 0 | `databases/keywords.json` | 完整重复；需保持 stable ID 及 normal/low 疾病关键词规则 |
| `locations.json` | 4 | 4 | 0 | 0 | `databases/locations.json` | 已复制 |
| `medicines.json` | 170 | 146 | 24 | 0 | `databases/medicines.json`、`medicineCategories.json` | 已迁移；24 条有字段变化，需核对分类和处方效果 |
| `npcs.json` | 6 | 6 | 0 | 0 | `databases/npcs.json` | 已复制 |
| `skills.json` | 3 | 3 | 0 | 0 | `databases/skills.json` | 已复制 |
| `social_apps.json` | 3 | 3 | 0 | 0 | `social-apps.json` | 已复制；`chatgtpDaily` 另有拆分数据需要核对 |
| `special_events.json` | 11 | 2 | 9 | 0 | `databases/specialEvents.json`、`activities/event__*.json` | 已拆分/规范化；需核对自动触发、条件和 Activity 入口 |
| `turtle_soups.json` | 6 | 6 | 0 | 0 | `databases/turtleSoupPuzzles.json` | 已收敛为单一 canonical database owner |
| `work*.json` / `social*.json` / `*pub.json` | 92 个顶层记录（work 59、social 33） | 0 | 92 | 0 | `activities/`、`databases/patients.json`、`activity-manifest.json` | 已进行结构迁移，但必须做逐条 Activity、队列、患者和副作用闭环 |

未列入记录数的 legacy 文件仍需审计：`calendar.json`、`chatgtp_daily_import.json`、`chatgtp_qa.json`、`global_variables.json`、`maininit.json`、`mainpub.json`、`time_rules.json`。这些文件的有效内容主要位于配置对象、嵌套 entries 或数组，不适合使用顶层 `id` 计数判断是否迁移。

## 4. 明确的待迁移/待闭环内容

### P0：canonical 数据已有，但必须完成 owner 与运行时闭环

1. **工作患者流程**：`work01a`、`work02a`、`work03a`、`work04a`、`work06a`、`work07a`、`work07b` 与 `data/databases/patients.json`、`data/activities/patient_*.json`、`patient-queue-manager.json` 对齐。需逐条确认患者 ID、诊断选项、诊疗结果、收入/状态副作用、Activity manifest 和恢复行为。
2. **社交/宿舍流程**：`social01a/b` 至 `social07a/b`、`socialpub` 与 `data/activities/social*.json`、`dorm_activity_day*.json`、`social-story-manager.json` 对齐。需核对未迁移的空壳文件是否是历史占位，以及每个分支是否真正可排队、可执行、可保存。
3. **结局和特殊事件**：legacy 蓝图已经被拆成数据库记录与 `ending__*` / `event__*` Activity；需验证入口条件、显示接收器、CG/图片、结局成就和存档持久化，而不能只根据同 ID 或文件名判定完成。
4. **HIS 自定义应用**：`app_his_custom.json` 中旧 widget ID 有 8 个未直接映射到 canonical 同 ID。应以 `data/windows/his.json`、`data/app-definitions.json`、`data/activities/his__*.json` 为目标，验证患者选择、搜索、诊断、处方、提交、刷新和窗口生命周期。

### P1：内容已有对应物，但仍有重复 owner 或字段差异

1. `turtle_soups.json` 已收敛到 `data/databases/turtleSoupPuzzles.json`；后续只需维护该 database owner。
2. `diagnoses.json`、`endings.json`、`medicines.json`、`items.json`、`achievements.json` 和 `special_events.json` 的同 ID 变换记录需要输出字段差异清单，并为关键行为增加确定性 probe。
3. `bgm.json`、`cg.json`、`social_apps.json` 等数据虽逐条相同，仍需验证资源路径、媒体显示和实际窗口/Activity 消费者。
4. `calendar.json` 与 `time_rules.json` 应对照 `calendar-rules.json`、`activity-calendar.json`、framework 时间/状态 Activity，确认工作边界、夜班、睡眠和跨日规则没有只迁移文本而遗漏状态副作用。
5. `global_variables.json` 应对照 `public-variables.framework.json` 和现有 state/save owner，不能把旧变量表仅视为无运行时影响的配置。
6. `chatgtp_daily_import.json`、`chatgtp_qa.json` 已分别对应 `databases/chatgtpDailyMessages.json`、`databases/chatgtpQaEntries.json` 和 `chatgtp-settings.json`；本次已删除未注册的重复 `seed-records-chatgtp.json`，并将迁移脚本改为直接写 canonical database。仍需核对导入数量、疾病 normal/low 双版本、关键词触发和 SAN 代价。当前 canonical QA 有 48,195 条、daily message 有 34 条，不能用文件名相似或少量样本推断完整等价。

### P2：已执行的 legacy 内容包删除

- 删除前已确认 `parity-matrix.json` 的 `unmapped` 为空，legacy-reference、blueprint、ChatGTP 和 Turtle Soup 探针通过。
- 已删除 `data/game-content/legacy/zh-hans/` 的 54 个 legacy JSON，以及 `data/game-content/legacy-content-index.json`；`data/game-content/` 当前整体不存在。
- 一次性 `tools/migration/migrate-legacy-game-content.mjs` 和只服务于该保留包的 `tools/audit-legacy-ng.mjs` 同步删除；ChatGTP/医疗转换工具改为接受外部输入目录/文件，不再依赖仓库内 legacy 路径。
- legacy 目录删除不等于所有行为已浏览器验证；工作/社交/HIS/结局/特殊事件的运行时与 save/restore 仍按 parity matrix 标记分别验收。

## 5. 建议的后续验收顺序

1. 先建立逐条 parity matrix：legacy 文件/记录、canonical 文件/记录、Activity、manifest/list/calendar、runtime owner、save 字段、资源、probe、状态。
2. 修正审计工具的 source path，并增加：文件 SHA/normalized JSON、集合级稳定 ID、嵌套 entries、Activity 映射、重复注册、未消费 event route 检查。
3. 对工作、社交、HIS、结局、特殊事件分别运行结构探针和真实运行时探针，覆盖成功、失败、重复调用、持久化恢复和边界日期。
4. 保持 `turtleSoupPuzzles` 的单一 authoritative owner，避免两个 canonical 文件在未来分叉。
5. 仅在 canonical loader、ActivityScheduler、完整 probe suite 和发布版路径都通过后，再按文件级结论删除 legacy 副本；不能按“canonical 文件名相似”整体删除。

## 6. 验证证据与限制

已执行的盘点与迁移前检查：

- 工作区基线：分支 `ng...origin/ng`；本次变更后仍需提交前复核工作区
- `git diff --check`：通过（迁移完成后复核）
- 54 个 legacy JSON 与 preservation index 的 JSON 数量一致
- 全量 JSON 解析和跨目录 hash/normalized-JSON 对照
- legacy/canonical 顶层稳定 ID、记录数量、蓝图节点和连线盘点

- 本次已实际验证：

  - `node probes/turtle-soup-data-probe.mjs`：通过，6 个谜题由 canonical database owner 提供
  - ChatGTP 迁移脚本：读取 legacy QA 并写出 48,195 条 canonical database 记录；重跑后 canonical 文件无内容 diff
  - 完整 `probes/*.mjs`：42/42 通过
  - 相关 JSON 全量解析、Node 语法检查和 `git diff --check`
  - `node tools/publish.js`、发布入口语法检查和 retired path 扫描：通过

本报告没有声称以下内容已经通过：

- 浏览器 UI 交互等价性
- 每个 Activity 的完整执行路径
- EventBus route 到 authoritative state owner 的闭环
- save/restore、跨日、工作边界和失败分支等运行时行为
- canonical 数据编辑器写盘后的再加载

静态内容重复只能证明数据存在或相同，不能代替真实 runtime/browser 验证。
