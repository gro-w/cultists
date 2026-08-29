# 数据 Schema 与内容制作

所有游戏内容放在 `data/<language>/`，运行时代码只通过 `DataLoader` 按 ID 读取。除 UI 外壳文本外，不要把剧情、关键词内容、角色名或物品效果硬编码进应用。

## 语言文件

- `data/languages.json`：可用语言列表。
- `data/strings.<lang>.json`：UI 外壳、按钮、通知和菜单文本。
- `data/<lang>/`：该语言的完整游戏内容副本。

- 新增语言必须复制全部内容文件，包括 `work01a/b.json` 至 `work07a/b.json`、`social01a/b.json` 至 `social07a/b.json`、`global_variables.json`、`item_placements.json` 和 `items.json`。

## 日程文件

当前使用工作、社交和主要三个独立队列；ChatGTP 查询使用非阻塞的 `mainQueue`，不再有专用 ChatGTP 队列。工作/社交日程每天两个时间点追加，公共日程不会自动追加；`maininit.json` 中的日程则在游戏启动时一次性加入主要日程队列：

```text
work01a.json ... work07a.json   # 工作日/白班批次，08:00 追加
work01b.json ... work07b.json   # 工作/夜班批次，16:00 追加
social01a.json ... social07a.json
social01b.json ... social07b.json
workpub.json / socialpub.json     # 工作/社交公共日程文件，可由编辑器编辑
mainpub.json                      # 主要公共日程文件，通过 insertSchedule 插入 mainQueue
maininit.json                     # 游戏启动时加入 mainQueue 的初始日程
```

游戏流程只有第 1 至第 7 天。日历配置和运行时都会将天数上限限制为 7；第 7 天最终阶段结束后进入结局，不会推进到第 8 天。包含第 8 天及以后状态的旧存档会被拒绝加载，不会静默截断玩家进度。

文件最小结构：

```json
{ "displayName": "", "entries": [] }
```

`entries` 中的每项必须有全局唯一的稳定字符串 `id`。患者放在 `patients`，社交角色放在 `contacts`。NPC 联系人使用稳定 `npcId`，自定义角色使用 `type: "other"`、`name` 和 `avatar`。

日程先决条件写在 `prerequisites`，支持 `all` / `any`，以及 `scheduleCompleted`、`globalVariables`、`protagonist`、`npc` 和 `item` 条件。条件在日程实际入队时检查。

```json
{
  "id": "case-02",
  "prerequisites": {
    "all": [
      { "scheduleCompleted": "case-01" },
      { "globalVariables": [{ "id": 1, "op": "gte", "value": 2 }] },
      { "protagonist": { "stat": "mental", "op": "gte", "value": 50 } },
      { "npc": { "npcId": "ajie", "stat": "favorability", "op": "gte", "value": 60 } },
      { "item": { "itemId": "key", "held": true, "count": 1 } }
    ]
  }
}
```

任何效果对象都可以使用公用操作 `operations`，把指定 ID 的日程计时到指定的游戏绝对分钟：

```json
{ "operations": [{ "type": "addSchedule", "scheduleId": "pub-night-01", "addTime": 3360 }] }
```

`addTime` 必须是非负、20 分钟的整数倍，使用与游戏时钟相同的绝对分钟坐标。执行操作时只创建计时器；计时器到期后才检查日程先决条件，并把日程加入其来源文件决定的 Work 或 Social 队列。`socialpub.json` / `workpub.json` 的条目不会随日期检查点自动追加。旧的 `addSchedule` 简写仍可读取，但新内容应使用 `operations`。

`maininit.json` 和 `mainpub.json` 使用 `{ "entries": [] }` 顶层结构；其中每个条目的 `id` 是稳定日程 ID。`maininit.json` 的条目启动时以 `main` 队列实例加入，并由统一 `ScheduleRunner` 执行。`mainpub.json` 只注册主要公共日程定义；通过 `insertSchedule` 指定 `queue="main"` 插入的日程进入主要日程队列并由同一运行时执行。`insertSchedule` 还可传入 `respectPrerequisite`（默认 `true`）和 `protectFromExpiry`（默认 `false`）；前者为 `false` 时跳过蓝图先决条件，后者为 `true` 时在实例上记录免过期标记。初始主要日程的条件等待应使用 `waitUntil`，不应在应用层另行订阅或轮询。

Social 日期日程条目所在的完整蓝图必须有且只有一个 `prerequisite` 节点。它是在到达该日期和时间时才求值的受限控制节点；没有任何输出引脚，也没有流程引脚，只接收 `condition` 数值输入。其输入为严格 `true` 时，条目才会创建实例并加入 `socialQueue`。非法或求值失败均跳过条目。普通蓝图仍必须有且只有一个 `flowStart`，所有流程末端必须是 `scheduleEnd`。

完整蓝图必须有且只有一个 `scheduleExpiry` 节点。它没有流程引脚，数值输入为 `expires`（是否会过期）和 `expiresAt`（绝对游戏分钟）；新建模板默认 `expires=false`。`expires` 不为严格 `true` 时实例不会过期，否则当前游戏时间超过 `expiresAt` 后，未解决实例会被强制标记为 `resolved`。

## 公共变量

开发人员模式中，系统预留公共变量（`id=0..99`）的 ID、名称和类型不可编辑且不可删除，但默认值可以编辑；运行时当前值在调试器中编辑。公共变量编辑器和调试器均提供三个互斥显示选项：不看系统预留公共变量、不看没有意义的系统公共变量、不隐藏系统公共变量，默认选中第二项。第二项保留 `0、1、2、5`，以及按实际技能数量和 NPC 数量分配的 `20..39`、`40..59`、`60..79` 变量，并隐藏其他未分配的预留变量。

文件：`global_variables.json`。顶层必须是数组，每项包含：

```json
[
  { "id": 0, "name": "怀疑度", "type": "number", "default": 0 },
  { "id": 1, "name": "主角SAN", "type": "number", "default": 100 },
  { "id": 2, "name": "金钱", "type": "decimal", "default": 0 },
  { "id": 5, "name": "ChatGTP SAN", "type": "number", "default": 80 },
  { "id": 20, "name": "主角技能0点", "type": "number", "default": 0 },
  { "id": 40, "name": "NPC0好感度", "type": "number", "default": 0 },
  { "id": 60, "name": "NPC0 SAN", "type": "number", "default": 0 }
]
```

实际语言数据还必须包含全部 `id=0..99` 的系统预留定义；上例只展示关键 ID。系统预留变量的初始值唯一来自本文件的 `default`，技能定义、NPC 定义和 NPC 状态配置不得另行提供或覆盖这些变量的初始值。

约束：

- ID 是从 0 开始的非负整数，不能重复；定义会按 ID 排序。
- `type` 只能是 `bool`、`number`、`decimal`、`string`。
- `number` 和 `decimal` 的默认值、运行时值必须在 `0..256`；`decimal` 会四舍五入并保持小数点后 2 位精度。
- bool 必须使用 JSON 布尔值，字符串必须使用 JSON 字符串。
- `default` 是读档缺少对应值时的回退值。

### 技能与 NPC 数值 ID

`skills.json` 的每个技能和 `npcs.json` 的每个 NPC 必须包含从 `0` 开始、范围为 `0..19` 且不重复的 `numericid`。该 ID 是稳定的数值映射，不随数组排序变化：技能 `numericid=n` 使用公共变量 `20+n`；NPC `numericid=n` 使用公共变量 `40+n` 保存好感度、使用 `60+n` 保存 SAN。公共变量 `3` 是 NPC 不稳定 SAN 阈值，`4` 是 NPC 下线 SAN 阈值；NPC 状态规则文件及其专用编辑器已移除。

条件可写在对话节点、选项、日程条目、特殊事件、道具和结局中：

```json
{ "condition": { "id": 0, "equals": true } }
```

```json
{
  "condition": {
    "globalVariables": [
      { "id": 1, "op": "gte", "value": 10 },
      { "id": 2, "op": "gte", "value": 0.01 }
    ]
  }
}
```

支持 `eq`、`neq`、`gt`、`gte`、`lt`、`lte`，以及 `all`/`any` 组合。效果写在 `onShow.globalVariables`、`useEffect.globalVariables` 等字段中：

```json
{
  "globalVariables": [
    { "id": 0, "value": true },
    { "id": 1, "delta": 5 },
    { "id": 2, "value": 12.5 }
  ]
}
```

`number` 和 `decimal` 支持 `delta`；其他类型使用 `value`。`decimal` 的 `delta` 运算结果也会按小数点后 2 位精度归一化。

## 旧式 dialogueTree（仅兼容读取）

历史数据中的 `dialogueTree` 仍可由 `ScheduleBlueprint.migrateDialogueTree()` 转换，但新内容不得再使用它。HIS 和 Social 的正式运行入口都是对象式日程蓝图和共用的 `ScheduleRunner`：

```json
{
  "start": "start",
  "nodes": {
    "start": {
      "speaker": "npc",
      "text": "你好 [[keyword_id]]",
      "condition": { "id": 0, "equals": true },
      "options": [
        { "label": "继续", "next": "next_node", "condition": { "id": 1, "op": "gte", "value": 1 } }
      ],
      "onShow": {
        "globalVariables": [{ "id": 1, "delta": 1 }]
      }
    }
  }
}
```

该示例仅用于理解旧数据，不应作为新数据模板。关键词只通过文本中的 `[[keyword_id]]` 引用；新 entry 不要添加额外的 `keywordIds` 代替标记。

## 日程蓝图

新日程可以使用对象式蓝图：`nodes` 是节点 ID 到节点对象的映射，`connections` 保存类型化引脚连接，`startNodeId` 指向唯一的 `flowStart` 节点。流程引脚只能连接流程引脚，数值引脚只能连接数值引脚；一个节点不能同时拥有流程输出和数值输出。旧 `dialogueTree` 会在运行时兼容迁移。完整的节点端口、运行时语义和蓝图语法见 [`SCHEDULE-BLUEPRINTS.md`](./SCHEDULE-BLUEPRINTS.md)。

当前注册的节点包括：`flowStart`、`scheduleEnd`、`text`、`choice`、`randomBranch`、`branch`、`waitUntil`、`diceCheck`、`segmentBranch`、`consumeTime`、`setGlobal`、`ending`、`insertSchedule`、`showCg`、`showImage`、`inventoryOperation`、`statOperation`、`spellOperation`、`arithmetic`、`getGlobal`、`getInventory`、`getScheduleStatus`、`getScheduleInstanceCount`、`getGameTime`。

`consumeTime` 是一个流程节点，包含 `flowIn`、`flowOut` 和数值输入 `minutes`。它按输入值通过 `TimeService`/`GameState` 推进确定性的游戏时间，并触发现有的阶段、日程和结算检查点；20 分钟是普通行动的约定单位，蓝图运行器本身不把 `minutes` 强制限制为 20 的倍数。数值输入可以连接运算或取值节点。完整节点语法见 [`SCHEDULE-BLUEPRINTS.md`](./SCHEDULE-BLUEPRINTS.md)。

### 时间规则文件

每种语言目录可以提供 `time_rules.json`，供 `TimeService` 读取阶段结算参数：`day.workMinutes`、`night.nightMinutes`、`fullSleepMinutes`、`insufficientSleepMinutes`、`sanRecoveryPerSleepHour`、`threeDaySleepDebtSanLoss` 和 `sanLossPerLateNightAction`。旧的 `action_budget.json`、`dialogueLimit`、`inspectLimit` 和按行动计数的预算字段已删除；不要在新数据中恢复这些字段。

`spellOperation` 是一个流程节点，使用节点上的 `spell` 对象调用 `SpellManager.learn()`。法术学习蓝图必须把 `consumeTime(240)` 放在 `spellOperation` 之前；创建蓝图前不得调用 `spellManager.learn()`。

日程队列中的实例使用 `${scheduleId}:${sequence}` 作为稳定实例 ID，并保存 `status`、`currentNodeId` 和 `transcript`。已完成实例可以重复打开并只读查看历史文本，但不会再次执行节点或重新选择。

## 物品

文件：`items.json`，顶层为 `items` 和可选的 `startingInventory`。常用字段：

- `usable`、`consumable`
- `useCondition.requires`：物品数量条件
- `useCondition.sanMin` / `sanMax`：SAN 条件
- `useCondition.globalVariables`：公共变量条件
- `schedules.investigate` / `schedules.use` / `schedules.obtain` / `schedules.lose`：四类直接嵌套在物品对象中的日程蓝图。使用和调查效果都使用通用的 `statOperation`、`inventoryOperation`、`setGlobal` 等操作节点表达，结局可放在结束节点的 `onShow.ending`，时间推进使用后继的 `consumeTime` 节点；按技能检定时，将 `getGlobal` 的 `value` 连接到 `diceCheck.n`。调查文本使用普通 `text` 节点，图片使用 `showImage`，调查文本可带 `inspection` 元数据以生成调查回调。`segmentBranch` 接收 `value`、`branchCount=n` 和降序的 `boundary0..boundaryN` 共 `n+2` 个数值输入，另有 `flowIn`，输出 `segment0..segmentN-1` 共 `n` 个流程分支；第 i 段满足 `boundary[i+1] < value ≤ boundary[i]`。
- realtime 操作使用运行时 effect：ChatGTP 可使用 `npcSanChanges`，HIS 使用 `medicalSubmission`，NPC 离线使用 `npcOffline`；这些 effect 与同一实例的时间推进一起执行。
- `isBook`、`spells`：可学习法术的书籍

调查蓝图普通 `text` 节点的 `inspection.revealKeywordIds` 会传给 `KeywordManager` 并自动收集；文本中的 `[[keyword_id]]` 标记仍由玩家点击收集。

## 场景物品摆放

`item_placements.json` 将场景摆放状态与背包分开管理。每项可配置位置、关联 `itemId`、初始摆放状态和按日期、phase、location、室友睡眠状态、公共变量决定的可见条件。拾取和放回会分别更新摆放状态与背包。

## 法术

法术不单独存放在新的 JSON 文件中，而是作为书籍定义中的 `spells` 数组：

```json
{
  "id": "book_example",
  "isBook": true,
  "spells": [
    { "name": "法术名", "description": "效果描述", "learnTimeMinutes": 240, "castSanCost": 5 }
  ]
}
```

当前实现约定：学习每个法术 240 分钟，施放消耗 5 SAN，法术 ID 由书籍 ID 和数组索引组成。当前仓库的书籍可能仍是空 `spells` 数组；代码存在不等于已有可学习内容。

ChatGTP 查询、HIS 诊断提交和 NPC 离线均使用带 `instanceId` 的 realtime/专用队列实例；它们的时间消耗与状态副作用必须由同一实例完成。睡眠、醒来和日结是 `TimeService` 的系统边界，不使用普通日程节点代替。

## 结局、特殊事件和成就

- `endings.json`：结局定义、属性阈值、最终阶段条件和默认结局。
- `special_events.json`：按 NPC、phase、日期、好感度、SAN 和公共变量覆盖日程角色。
- `achievements.json`：监听游戏事件、技能检定、好感度、SAN、阅读文本等条件。

修改稳定 ID 时必须搜索所有日程、对话、特殊事件、关键词、问答、存档索引和开发工具引用。
