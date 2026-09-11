---
name: cultists-project-development
description: Use for safe secondary development of the Cultists game.
version: 0.1.0
author: Cultists Project Contributors, Hermes Agent
license: MIT
platforms: [windows, macos, linux]
metadata:
  hermes:
    tags: [Cultists, game, architecture, data, blueprint, save, verification]
    related_skills: [game-activity-patient-dialogue]
---

# Cultists 项目二次开发 Skill

本技能是《完蛋，我被邪教徒包围了！》（项目名 `surrounded by cultists`）的项目级入门和行为规范。它给完全不了解仓库历史的 coding agent 提供足够的架构、数据、状态、蓝图、存档和发布边界知识，使 agent 能在修改前找到真实契约、做出最小改动并用实际结果验证。

本项目是无框架、无构建步骤的原生 HTML/CSS/ES6 modules 游戏。内容主要由 `data/<lang>/` JSON 驱动，代码只应依赖稳定 ID。本文档不是代码 API 的替代品；当本文档与当前源码冲突时，先读取并遵循 `AGENTS.md`、注册表、校验器和实际运行器，同时报告文档过期。

## When to Use

- 开始任何本项目的二次开发、bug 修复、数据制作或架构修改；
- 修改 `GameState`、时间、活动、对话、NPC、物品、存档、开发工具或发布脚本；
- 将剧本、事件、患者问诊或物品行为转换为 JSON/蓝图；
- 修改桌面窗口、任务栏、宿舍模式或应用入口；
- 需要判断某个状态字段、队列、数据文件或事件是否可以删除。

专项剧本转换可继续加载 `docs/skills/game-activity-patient-dialogue/SKILL.md` 和 `docs/SKILL-SCRIPT-TO-ACTIVITY-BLUEPRINT.md`。本技能优先规定项目全局边界和验证纪律。

## Non-negotiable behavior

1. 修改前先读取 `AGENTS.md`、相关文档、目标模块、数据 schema、调用点和事件订阅；不要凭文件名猜接口。
2. 先追踪权威 owner，再修改调用方。时间由 `TimeService`，公共变量由 `GlobalVariableManager`，队列由 `ActivityQueue`，活动执行由 `ActivityRunner`，存档由 `SaveManager` 负责。
3. 不要为了让一个调用“能跑”而新增第二套状态、时间、存档或副作用路径。
4. 内容放数据，通用行为放代码；不要把角色名、对白、关键词、物品效果或剧情条件硬编码到应用 UI。
5. 修改已有文件使用 `patch`；创建完整的新文件使用 `write_file`。保持 LF 换行，只触碰任务范围。
6. 不读取、打印、提交或传播凭据、`.env`、令牌和密码；发现敏感值时使用 `[REDACTED]`。
7. 不把“文件写入成功”当作“行为正确”；所有重要状态变化都要有确定性探针或真实读取验证。
8. 不主动打开浏览器做 UI 验证，除非用户明确要求或提供必须复现的步骤；静态验证结果和浏览器结果必须分开报告。
9. 不声称未运行的测试通过；工具失败、探针失败和已知限制必须原样报告。
10. 不在用户未要求时提交、push、改写历史或创建 PR。若用户明确要求交付，才按项目约定执行提交和远端同步。

## First-pass repository orientation

首次接触仓库时按以下顺序使用 `read_file`、`search_files` 和 `terminal`：

1. 读取根目录 `AGENTS.md`；
2. 读取 `README.md`、`docs/ARCHITECTURE.md`、`docs/DATA-SCHEMAS.md`、`docs/ACTIVITY-BLUEPRINTS.md`；
3. 检查 `git status --short`、当前分支和最近改动，不依赖会话开始时的快照；
4. 根据任务搜索符号定义和全部调用点，而不是只打开一个同名文件；
5. 确认语言目录、目标数据文件、加载器和发布脚本；
6. 修改前记录目标文件及不应被触碰的现有改动。

项目入口是 `index.html`。主要代码区域包括：

- `js/main.js`：启动、桌面、任务栏、应用 launcher 和宿舍模式协调；
- `js/core/`：状态、时间、队列、活动、数据加载、存档、公共变量、NPC 和事件基础设施；
- `js/apps/`：Social、HIS、ChatGTP 等应用层；
- `js/desktop/`：宿舍、开发工具、桌面窗口和调试器；
- `data/<lang>/`：语言相关的剧情、角色、活动、关键词、物品、结局和规则；
- `css/`：玩家 UI 和开发人员模式样式；
- `publish.js`：从源代码生成玩家版 `publish/`。

## Architecture and ownership

### State owner

`GameState` 保存主要运行状态：`day`、`clockMinutes`、`phase`、`duty`、`location`、`energy`、`mental`、`physical`、`satiety` 等。不要在应用、DOM 或队列实例中复制一份可写的游戏状态。

`DayNightSystem` 负责上下班、睡觉、醒来、工作日/休息日和最终阶段；`TimeService` 是普通游戏时间推进和阶段结算的唯一 owner。状态字段相互独立，不能只根据 phase 推断 duty/location。

需要新增全局状态时必须明确：

- 唯一 owner；
- 初始值和默认值来源；
- 事件语义；
- `snapshot/restore` 是否需要；
- `SaveManager` 是否持久化；
- 调试器是否只读或允许通过 owner API 修改。

不要把 `snapshot/restore` 自动等同于存档持久化；只有 `_encode()` 发出的 payload 并在 `_decode()` 及 owner restore 中还原，才是当前存档状态。

### EventBus

跨模块状态通知优先使用 `js/core/EventBus.js`。事件订阅必须：

- 订阅权威 owner 的事件；
- 不在展示监听器里偷偷推进时间或执行剧情副作用；
- 在窗口/应用关闭时解除订阅；
- 避免重复绑定和同步重入；
- 在事件 payload 中明确区分 `phaseChanged`、`automatic` 等语义。

事件监听器如果修改状态或消耗资源，就是正式执行路径，必须像普通函数一样审计和验证。

## Time and phase invariants

- 初始状态是第 1 天 `08:00`、`phase=day`、`duty=on-duty`、`location=work`；实际代码若已改变，先以代码和数据为准并更新文档。
- 工作窗口严格是 `[08:00, 16:00)`；天文白昼 `[06:00, 18:00)`，二者不能混用。
- 普通成功行动默认推进 20 分钟；不能用 `Date`、`getHours()`、浏览器 timer 或系统时间控制游戏时钟。
- 任何玩家可见的计时操作必须先创建活动实例，再由 `ActivityRunner` 或对应 runtime 执行。
- `consumeTime` 通过 `TimeService.advanceBy()` 推进游戏时间；不要在 App 点击处理器中直接追加同等时间作为隐藏副作用。
- 在恰好 `16:00` 时，状态边界、phase、duty、location 和活动加载必须保持一致；不要只更新时钟。
- 下班/睡觉的阻塞规则来自 `ActivityData` 的 pending batch；不要通过 UI 绕过普通阻塞，除非功能明确是开发调试器行为。
- 午夜到次日 `08:00` 只结算一次睡眠、医疗、收入支出和睡眠债；不要在多个监听器重复结算。
- 睡眠阈值和 SAN 规则必须读取 `data/<lang>/time_rules.json` 及 `TimeService` 的实际逻辑。

修改时间边界、行动费用、睡眠规则或状态字段时，必须检查所有 App、快捷入口、存档恢复、活动运行器和事件订阅。

## Queue and activity architecture

当前队列是三个独立队列：

- `workQueue`：工作/HIS 类活动；
- `socialQueue`：下班、宿舍和 Social NPC 对话；
- `mainQueue`：非阻塞初始化、公共主流程以及迁移后的 ChatGTP 查询等。

项目不再使用独立的 `chatgtpQueue`。ChatGTP 应用本身仍然是有效功能；删除专用队列不等于删除 `ChatGTPApp`、ChatGTP SAN、问答数据或窗口注册。修改队列时必须同时检查导出、校验、路由、运行器统计、调试器、存档 payload、恢复逻辑、文档和 `publish/`。

队列实例是执行和恢复的权威身份，不能把界面联系人 ID 或 transcript 当作新实例。实例至少可能包含：稳定 `activityId`、`instanceId`、`status`、`currentNodeId`、`executedNodeIds`、`transcript` 和 payload。新增实例、checkpoint、resolve、restore 必须通过队列 owner 的公开 API。

宿舍/下班 NPC 对话属于 `socialQueue`：

1. 从队列 pending 实例中按 `npcId` 查找；
2. 找到同一 NPC 的未 `resolved` 实例时复用第一个实例；
3. 不因点击一个已经 resolved 的视觉 actor 就无条件创建新实例；
4. 找不到 pending 实例时显示无新对话，并保持队列长度不变；
5. checkpoint 和完成标记更新精确的 `instanceId`；
6. `mainQueue` 仅用于初始化和明确的 main 活动。

## Data and content rules

所有游戏内容放在 `data/<lang>/`，通过 `dataLoader.loadJSON("file.json")` 加载。不要硬编码 `data/zh-hans/` 路径，也不要只改一种语言却声称多语言完成。

UI 外壳字符串走 `i18n.t()` 和 `data/strings.<lang>.json`；对白、剧情、关键词和角色内容直接放语言数据。NPC 持久化使用稳定 `npcId`，不要使用显示名。

常见数据文件包括：

- `npcs.json`、`skills.json`：角色和技能 roster；
- `workXXa/b.json`、`socialXXa/b.json`：日期/阶段活动；
- `workpub.json`、`socialpub.json`：公共 Work/Social 定义；
- `maininit.json`、`mainpub.json`：主流程初始化和公共定义；
- `keywords.json`、`chatgtp_qa.json`：关键词和问答；
- `items.json`、`item_placements.json`：物品、物品蓝图和场景摆放；
- `global_variables.json`：公共变量定义和固定默认值；
- `time_rules.json`：时间、睡眠和 SAN 结算参数；
- `endings.json`、`special_events.json`、`achievements.json`：结局、特殊事件和成就。

新增或修改数据后要验证：JSON、稳定 ID、引用关系、schema、LF、运行时加载入口和发布副本。保留目标文件中不属于任务范围的已有条目。

### Global variables

公共变量定义顶层是数组，ID 唯一、非负整数；类型是 `bool`、`number`、`decimal` 或 `string`。数值范围和 decimal 精度以 `GlobalVariableManager` 与 schema 为准。

系统预留变量包括主角 SAN、金钱、ChatGTP SAN、技能点、NPC 好感度和 NPC SAN 的固定 ID 范围。其初始值唯一来自 `global_variables.json` 的 `default`；不要让 roster、构造函数或启动代码再次覆盖这些默认值。变量效果使用 `value`；只有 number/decimal 才使用 `delta`。

## Blueprint authoring

蓝图的权威资料是 `docs/ACTIVITY-BLUEPRINTS.md`，实际节点以 `js/core/ActivityNodeRegistry.js` 为准，验证以 `ActivityBlueprint.js` 为准，执行以 `ActivityRunner.js` 和 `ActivityValueEvaluator.js` 为准。

新蓝图使用：

```json
{
  "startNodeId": "start",
  "nodes": {},
  "connections": []
}
```

必须满足：

- 一个 `flowStart`，`startNodeId` 指向它；
- 至少一个 `activityEnd`；
- 节点映射键等于节点对象的 `id`；
- 流程连接是 `fromNodeId/fromPort → toNodeId/toPort`；
- 数值连接也使用类型化连接，但求值从目标输入反向查找上游；
- `choice.branchCount`、`labelN`、选项记录和 `optionN` 连接一致；
- 所有可达分支最终到达 `activityEnd`；
- 注册节点、端口和字段之外不要发明自定义运行语义；
- 不要把新内容写成旧式 `dialogueTree`，除非任务明确是兼容迁移。

常用节点：`flowStart`、`text`、`choice`、`branch`、`waitUntil`、`segmentBranch`、`consumeTime`、`setGlobal`、`statOperation`、`inventoryOperation`、`insertActivity`、`showCg`、`showImage`、`spellOperation`、`prerequisite`、`activityExpiry` 和 `activityEnd`。

每行玩家可见对白都应是可达的 `text` 节点。选项后的好感度、怀疑度、物品和属性改变必须通过显式操作节点连接；不要把新效果藏进废弃的 `options[].effects` 或仅供编辑器显示的字段。

把自然语言剧本转换成蓝图时，先建立结构表：目标文件、稳定 ID、NPC ID、入口条件、共同对白、每个选项、分支对白、效果、汇合点和结束点。之后再建图。不要边读长剧本边直接拼 JSON。

### Time nodes in dialogue

如果一段 NPC 对话目标约为 240 分钟，通常可使用约 12 个 `consumeTime(20)` 节点，但不能把它们：

- 合并成末尾的 `consumeTime(240)`；
- 连续堆在 `activityEnd` 前；
- 全部集中在最前面的共同流程。

应把时间节点贯穿整条流程：前段共同对白、中段对白、选项分支后的对白和后段对白都可以放置。最后一句对白不应直接接时间节点再结束。按所有可达路径计算最小、最大和平均成本；不同分支因对白长度产生小幅浮动可以接受，但不能漏掉整段时间成本。还要结合 NPC 睡眠时间和 Social/Dorm 可用性检查：仅比较“NPC 数量 × 单次成本”是不够的。

## App and UI rules

应用层负责打开窗口、读取队列实例、展示文本、收集用户选择和调用 owner API；不要让 DOM 成为持久化状态，也不要让 UI 自己执行剧情副作用。

窗口、联系人、编辑器和调试器必须使用稳定的 app/entry/instance ID。动态列表重渲染时清理旧监听器，重复窗口必须隔离 DOM 查询、事件上下文、选中状态和 radio name。宿舍中的室友按稳定 NPC ID 使用对应立绘作为可点击目标，并保留 `alt`、键盘 Enter/Space 和状态提示。

普通游戏 UI 与开发工具 UI 必须明确分界。不要为了调试方便把开发按钮、调试 API、开发 CSS 或 `?dev` 分支泄漏到玩家版。

## Save and restore rules

修改任何会影响当前游戏进度的字段、队列、窗口恢复或编码布局时，先从实际 `SaveManager._encode()` 枚举 payload，再追踪 `_decode()` 和 owner restore。不要只看到 manager 有 `snapshot()` 就以为已持久化。

新增 payload 字段时评估存档格式版本；改变队列名称、删除队列字段或改变编码结构不能静默兼容。恢复时要校验 payload shape，并在失败路径的 `finally` 中释放 restore guard。恢复完整状态前清理默认/旧状态，避免第二次读档泄漏第一次读档的数据。

对话存档必须持久化队列实例进度，并在恢复后把正确的 `currentNodeId` 传回 runner；仅保存 transcript 不足以恢复对话位置。跨运行成就属于成就管理器，不应伪装成单次存档状态。

## Developer mode and publish boundary

开发人员模式的专用代码、入口、调试器、API、状态修改器和 CSS 必须使用项目规定的 `DEV-TOOLS:START` / `DEV-TOOLS:END` 标记或等价的发布剥离规则。开发入口只能严格判断 `?dev`，不能把任意查询串当作开发模式认证。

玩家版 `publish/` 的要求比“隐藏入口”严格：除明确要求保留的成就定义外，不得包含开发人员模式相关的 HTML、JS、CSS、入口判定、开发 API、调试器、开发事件订阅、开发状态 mutator、`DeveloperMode`、`dev-server.js` 或开发 UI 文本。每次源代码发布边界变化后都要重新运行 `node publish.js`，递归扫描实际 `publish` 产物，并检查 bootstrap 语法。

## Safe change procedure

### 1. Scope

明确用户要求、目标文件、不可改变的行为、是否涉及运行时代码、是否涉及发布边界和是否涉及存档格式。使用 `todo` 管理三个以上步骤的任务。

### 2. Discovery

并行读取相关文件和搜索定义/调用点。确认真实 schema、owner、事件、队列、入口和现有数据。若看到重复 ID、CRLF、残留旧字段或之前未验证的改动，先记录并处理，不要继续叠加假设。

### 3. Design

先写数据/状态变更表或图结构草图。对于蓝图，列出每条分支；对于状态改动，列出 owner、输入、输出、事件和存档；对于删除功能，列出 loader、调用方、编辑器、CSS、文档、save、publish 和生成副本。

### 4. Edit

使用最小范围 `patch` 或新文件 `write_file`。不做无关格式化、重命名、历史改写或依赖引入。批量生成必须按稳定 ID reconcile，不能盲目 append。

### 5. Verify

至少执行：

```bash
node --check <每个修改的 JS 文件>
python3 <目标 JSON 确定性校验脚本>
git diff --check
```

蓝图任务还要验证节点注册、连接端口、可达性、所有分支结束、内容覆盖和路径时间成本。运行时任务还要验证初始值、边界、失败路径、恢复和副作用只执行一次。发布任务还要执行：

```bash
node publish.js
node --check publish/js/main.js
```

并递归扫描 `publish/` 的 HTML、JS、CSS 和数据，确认开发代码或已删除功能没有残留。

### 6. Report

最终报告必须包含实际修改文件、行为变化、真实验证输出、未验证内容和已知限制。若用户要求交付，再执行约定的 commit/push/fetch/pull 和本地/远端 SHA 比较；成功执行 push 不能单独证明远端已同步。

## Deterministic verification patterns

### JSON and LF

对每个目标文件读取 bytes：拒绝 `\r`，解析 JSON，确认顶层和条目结构，检查稳定 ID。不要用只检查一个文件的探针替代项目范围 ID 扫描。

### Blueprint paths

从每个 `startNodeId` DFS/BFS 遍历所有 flow connection：

- 起点存在且类型正确；
- 连接两端节点存在；
- 端口符合 registry；
- 所有可达节点被覆盖；
- 所有路径都到 `activityEnd`；
- 对每条路径统计 `consumeTime.inputs.minutes`；
- 节点 ID 的重复检查按单个蓝图进行，活动条目 ID 才按项目范围检查。

### Source/data probes

静态搜索不能证明运行时行为。对关键规则编写小型、确定性的 probe，例如：

- 复用 pending Social 实例而不重复 append；
- resolved NPC 没有 pending 时队列长度不变；
- choice 每个出口都能到 end；
- 时间节点每条路径成本和位置符合目标；
- save round-trip 前后字段和队列实例一致；
- 删除专用队列后导出、路由、存档、调试器和 publish 均无残留；
- 发布版保留指定成就定义但无其他开发模式残留。

## Stop conditions and escalation

当 schema、稳定 ID、条件来源、存档兼容策略或时间设计目标缺失，并且无法从仓库读取时，停止猜测并向用户提出最小必要问题。低风险默认值可以自行决定，但必须在设计和最终报告中明确假设。

如果同一文件经过约三次修改仍无法通过验证，停止继续盲改；重新读取完整文件、缩小问题，或报告阻塞。工具返回空结果、异常窄结果或与源码矛盾时，换搜索策略并重新确认，不要把空结果当作“没有引用”。

## Final checklist

- [ ] 已读 `AGENTS.md` 和相关 schema/架构文档；
- [ ] 已追踪 owner、调用点、事件订阅和存档路径；
- [ ] 没有新增重复状态、重复时间执行器或隐藏副作用；
- [ ] 数据使用稳定 ID，引用存在，未删除无关条目；
- [ ] 蓝图节点、端口、分支、汇合和结束路径有效；
- [ ] 时间节点分布符合体验目标，不集中在开头或结尾；
- [ ] JSON、LF、JS syntax、确定性 probe、`git diff --check` 已通过；
- [ ] 若涉及发布，`publish/` 已重建并完成残留扫描；
- [ ] 最终报告只声称实际验证过的结果；
- [ ] 未经用户要求没有提交、push 或改写历史。
