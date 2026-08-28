# Cultists 游戏引擎二次开发手册

本文面向需要新增剧情、系统、编辑器功能或语言数据的开发者。项目是无构建步骤的原生 ES6 Web 游戏；浏览器直接加载 `index.html`，模块通过 `import`/`export` 组织，内容由 `data/<lang>/*.json` 驱动。

## 1. 开发原则

- **单一状态 owner**：每个持久状态只由一个核心 singleton 修改，其他模块通过公开方法和 `EventBus` 通信。
- **数据驱动**：剧情、日程、角色、关键词、物品、医疗和结局放入语言数据；代码只依赖稳定 ID。
- **确定性时间**：游戏时间由 `GameState.clockMinutes` 和 `TimeService` 管理，不得使用 `Date`、`getHours()`、真实计时器或系统时间推进游戏。
- **日程是计时操作的执行身份**：玩家可见的对话、查询、物品调查/使用、诊断提交、法术学习/施放和 NPC 离线都必须先创建日程实例，再由 runner/runtime 执行。
- **显示与执行分离**：UI 只创建实例、显示当前节点并提供继续/选择；副作用、时间推进和完成标记由日程执行器负责。
- **向后兼容要显式**：旧数据只在明确的迁移边界转换；不要让新运行时悄悄接受半旧格式。

## 2. 启动链与模块边界

入口是 `index.html`，组成根是 `js/main.js`。启动顺序的概念模型如下：

```text
index.html
  -> main.js
     -> SettingsManager / DataLoader
     -> 并行初始化内容 singleton
     -> SaveManager 初始化与恢复 URL 存档
     -> Desktop / Taskbar / DormMode
     -> 根据 GameState 挂载当前工作或宿舍模式
```

核心模块职责：

| 模块 | 唯一职责 |
| --- | --- |
| `GameState` | 日期、时钟、phase、duty、location、主角属性及快照恢复 |
| `TimeService` | 普通时间推进、跨午夜、08:00 结算、睡眠恢复和时间事件 |
| `DayNightSystem` | 上下班、睡觉、阻塞检查和模式转换入口 |
| `ScheduleData` | 读取日程文件、维护动态插入、按时间追加实例 |
| `ScheduleQueue` | 保存 `work`、`social`、`chatgtp`、`realtime` 实例及状态 |
| `ScheduleBlueprint` | 蓝图规范化、端口校验、可达性检查和旧树迁移 |
| `ScheduleNodeRegistry` | 节点类型、流程/数值端口和动态 choice 端口定义 |
| `ScheduleRunner` | 按流程节点执行蓝图、暂停等待 UI、记录 transcript |
| `ItemScheduleRuntime` | 物品和其他非阻塞操作的日程运行时 |
| `DialogueEffects` | 对话节点/选项显示时的共享副作用 |
| `SaveManager` | v12 URL 存档、索引、队列实例、窗口和持久状态恢复 |
| `DataLoader` | 语言目录 JSON 加载、缓存和开发服务器读写桥接 |

新增系统前先确定 owner、输入数据、输出事件、快照字段和恢复顺序；不要把状态放在 App 的局部变量中。

## 3. 游戏状态和时间

初始状态：第 1 天 `08:00`，`phase=day`、`duty=on-duty`、`location=work`。

- 工作窗口是 `[08:00, 16:00)`。
- `phase` 的 `day/night` 表示日程时段；`duty` 和 `location` 是独立状态。
- 普通行动时间必须是非负的 20 分钟整数倍，调用 `timeService.advanceBy(minutes)`。
- 工作结束、睡眠、醒来和最终阶段是显式系统边界，不是普通叙事节点。
- 夜间跨过午夜立即进入下一游戏日；到次日 `08:00` 只结算一次睡眠、医疗、收入支出和睡眠债。
- 第 7 天结束后进入结局，不应继续推进到第 8 天。

正确的计时调用链：

```text
App 点击
  -> 创建 ScheduleQueue 实例
  -> ScheduleRunner / ItemScheduleRuntime
  -> consumeTime 或 runtime effect
  -> TimeService.advanceBy()
  -> ScheduleData.advanceTo()
  -> EventBus / UI 刷新
```

禁止在 App 中直接推进普通行动时间，禁止在创建日程前调用 `SpellManager.learn()`、医疗提交或 NPC 离线状态切换。失败校验和取消操作不应消耗时间。

## 4. 日程队列与实例

四个运行时队列：

- `workQueue`：工作日程和 HIS 对话。
- `socialQueue`：Social 对话。
- `chatgtpQueue`：ChatGTP 查询，单当前实例。
- `realtimeQueue`：物品、法术、诊断、NPC 离线等非阻塞实例。

`ScheduleQueue.append()` 可接受单对象或数组，并返回带 canonical `instanceId` 的实例。实例核心字段：

```json
{
  "scheduleId": "social01a",
  "instanceId": "social01a:1",
  "status": "unresolved",
  "payload": {},
  "currentNodeId": "node-id",
  "executedNodeIds": [],
  "transcript": []
}
```

状态只有 `unresolved` 和 `resolved`。保存/恢复时必须验证实例 ID 唯一、scheduleId 非空、status 合法、transcript 为数组。完成实例可以只读重放 transcript，不能重新执行副作用。

队列不是内容源文件：运行时队列可能含已消费、条件过滤或动态插入实例。开发编辑器必须编辑 `socialXXa/b.json`、`workXXa/b.json` 等源文件，而不是把 live queue 序列化回源文件。

## 5. 对象式日程蓝图

日程文件的最小结构是：

```json
{
  "displayName": "夜聊",
  "entries": []
}
```

每个 entry 至少包含稳定 `id` 和蓝图；Social 通常包含 `type`、`npcId`，Work 患者包含医疗字段。新蓝图格式：

```json
{
  "nodes": {
    "start": { "id": "start", "type": "flowStart", "inputs": {}, "outputs": {} },
    "say": { "id": "say", "type": "text", "inputs": { "speaker": "npc", "text": "你好" }, "outputs": {} },
    "end": { "id": "end", "type": "scheduleEnd", "inputs": {}, "outputs": {} }
  },
  "connections": [
    { "fromNodeId": "start", "fromPort": "flowOut", "toNodeId": "say", "toPort": "flowIn" },
    { "fromNodeId": "say", "fromPort": "flowOut", "toNodeId": "end", "toPort": "flowIn" }
  ],
  "startNodeId": "start"
}
```

硬性规则：

1. 恰好一个 `flowStart`，`startNodeId` 必须指向它。
2. 至少一个 `scheduleEnd`。
3. 流程引脚只能连接流程引脚，数值引脚只能连接数值引脚。
4. 每个流程节点都必须从起点可达，并最终能到达结束节点。
5. `fromNodeId/fromPort -> toNodeId/toPort` 是唯一连接表达方式。
6. value edge 是反向求值依赖：执行输入端时，通过 `toNode/toPort` 找到上游 `fromNode/fromPort`。
7. 节点坐标 `x/y` 属于编辑器元数据，但应随蓝图保存以保留布局。

当前节点由 `ScheduleNodeRegistry.js` 注册：`flowStart`、`scheduleEnd`、`text`、`choice`、`branch`、`diceCheck`、`consumeTime`、`setGlobal`、`insertSchedule`、`showCg`、`inventoryOperation`、`statOperation`、`spellOperation`、`arithmetic`、`getGlobal`、`getInventory`、`getProtagonistStat`、`getScheduleStatus`、`getScheduleInstanceCount`、`getGameTime`。

### 常用节点

- `text`：读取 `speaker`、`text`，执行 `onShow`，记录 transcript，然后等待“继续”。
- `choice`：读取 `branchCount`，动态生成 `label0...labelN` 与 `option0...optionN`，等待玩家选择。
- `consumeTime`：`minutes` 必须是 20 的倍数，通过 `TimeService` 推进。
- `branch`：根据 `condition` 选择 `true/false` 流程输出。
- `setGlobal`：修改公共变量；变量 ID、类型和值必须符合 `global_variables.json`。
- `insertSchedule`：通过 `ScheduleData` 动态插入日程，不能直接写 queue。
- `spellOperation`：学习法术；学习蓝图必须先连接 `consumeTime(240)`。
- `scheduleEnd`：标记实例完成并发出 `schedule:resolved`、`schedule:completed`。

### choice 的数据同步

编辑器修改 `branchCount` 时必须同步：

- `inputs.branchCount`；
- 兼容字段 `options` 的数量和 label；
- `labelN` 输入；
- 超出新数量的 option 连接。

运行时即使没有 `options` 数组，也应根据 `branchCount` 和 `labelN` 构建可见选项。条件过滤不能改变原始 branch index，否则 `optionN` 会指向错误分支。

## 6. 对话与 Galgame 显示模型

`ScheduleRunner` 每遇到 `text` 节点就暂停；有 UI 容器时等待明确的继续动作，遇到 `choice` 时等待选项。无 UI 容器的 headless realtime 日程必须自动继续，不能因为没有按钮而死锁。

`transcript` 是持久化历史；当前画面是单独的 active dialogue container。Social、HIS、Monitor、Dorm、ChatGTP 的 renderer 应替换当前内容，而不是追加成聊天记录。读档/只读回放时可以遍历 transcript，但不能重新执行节点副作用。

关键词只使用文本标记：`[[keyword_id]]`。角色显示名不是持久化 ID；NPC 引用使用 `npcId`。

## 7. 内容数据与引用

所有数据通过 `dataLoader.loadJSON("file.json")` 加载，禁止硬编码语言目录。

主要文件：

- `work01a.json` 至 `work07b.json`：患者和工作日程。
- `social01a.json` 至 `social07b.json`：社交日程。
- `workpub.json`、`socialpub.json`：公共日程。
- `npcs.json`：稳定 NPC ID、名称、头像和初始状态。
- `keywords.json`：稳定关键词 ID 与内容。
- `chatgtp_qa.json`：关键词组合问答。
- `items.json`：物品、调查、使用效果和书籍法术。
- `item_placements.json`：场景物品摆放。
- `diagnoses.json`、`medicines.json`：医疗知识图谱。
- `global_variables.json`：顶层数组，ID 唯一，类型为 bool/number/string。
- `special_events.json`、`endings.json`、`achievements.json`：特殊事件、结局和成就。

生成内容时先读取 schema 和同类条目，再写入目标文件；保持原有条目、LF 换行和稳定 ID。新增角色、关键词、物品或诊断后，搜索日程、特殊事件、结局、存档索引和编辑器中的全部引用。

## 8. 开发人员模式

开发人员模式只在严格 `?dev` 下启用，源码块使用 `DEV-TOOLS:START/END`。当前入口包括状态、NPC 状态、背包、关键词、ChatGTP、NPC 列表、全局变量、JSON、物品、日程蓝图、BGM、位置和电脑内容编辑器。

旧的“对话分支树”“患者分支树”“Work 事件队列”“Social 事件队列”已删除；不要恢复这些旧入口。对话/患者内容统一通过“日程编辑器”按源文件和 entry 编辑对象式蓝图。运行时 queue 仅用于执行与保存，不是编辑器的内容来源。

编辑器保存语义：

- 保存到内存：只更新当前页面的文档缓存/运行时定义。
- 下载 JSON：导出文件，不修改仓库。
- 写入磁盘：仅开发服务器存在时，通过 `/api/file?f=...` 原子写入已存在 JSON。
- `FileReader` 导入必须限制在当前选择的文件上下文，不能让上传文件名改变写入目标。

## 9. 存档和版本

`SaveManager` 当前格式为 v12。它保存游戏状态、TimeService、四条队列、关键词、背包、医疗、NPC 状态、全局变量、窗口布局、法术和动态日程插入。存档是 URL query 中的 base64url 文本；索引表由已加载数据建立。

改变 payload、字段含义、编码或索引表时必须评估版本，并显式拒绝不支持版本；不能静默把旧数据当新格式。新增可恢复窗口要同时更新 `WINDOW_APP_IDS` 和 launcher 注册。恢复顺序要先加载 canonical data，再恢复状态和队列，最后刷新窗口。

## 10. 新功能实施清单

1. 阅读 `AGENTS.md`、本手册、`DATA-SCHEMAS.md` 和 `ARCHITECTURE.md`。
2. 搜索目标 symbol 的定义、调用点、事件订阅和保存字段。
3. 确定状态 owner、事件语义、时间成本和失败路径。
4. 先扩展 JSON schema/数据，再接入 runtime；不要在 App 中硬编码剧情。
5. 对蓝图调用 `validateBlueprint()`，对全局变量、ID、引用和边界做确定性探针。
6. 修改 JS 后执行 `node --check`；修改 JSON 后用 Python `json.load()` 全量校验。
7. 执行 `git diff --check`，检查 LF 和无凭据泄露。
8. 执行 `node publish.js`，确认发布目录不含开发代码，再检查 `publish/js/main.js`。
9. 按项目约定 commit、push，然后 pull/fetch 并确认本地 HEAD 与远端分支一致。

## 11. 快速排错

- **时间重复推进**：搜索 `advanceBy`、`item:used`、`dialogue:turn` 和相关 listener，确认只有一个日程执行器推进时间。
- **分支不可达**：运行 `validateBlueprint()`，检查 `startNodeId`、flow edge、动态 choice 数量和 `scheduleEnd`。
- **存档后窗口/队列丢失**：检查 SaveManager 的 encode/decode 两端、canonical index 初始化和 `WINDOW_APP_IDS`。
- **编辑器写错文件**：检查 file scope 是否从选择状态传入所有读取、导出和写盘 handler。
- **对话叠加显示**：检查 renderer 是否使用 `replaceChildren()`，并确认 transcript 只用于恢复/只读历史。
- **发布版带开发工具**：搜索 `DEV-TOOLS`、`DeveloperMode`、`dev-server.js` 和 `?dev`，重新运行 `node publish.js`。
