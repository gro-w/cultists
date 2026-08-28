# 数据 Schema 与内容制作

所有游戏内容放在 `data/<language>/`，运行时代码只通过 `DataLoader` 按 ID 读取。除 UI 外壳文本外，不要把剧情、关键词内容、角色名或物品效果硬编码进应用。

## 语言文件

- `data/languages.json`：可用语言列表。
- `data/strings.<lang>.json`：UI 外壳、按钮、通知和菜单文本。
- `data/<lang>/`：该语言的完整游戏内容副本。

- 新增语言必须复制全部内容文件，包括 `work01a/b.json` 至 `work07a/b.json`、`social01a/b.json` 至 `social07a/b.json`、`global_variables.json`、`item_placements.json` 和 `items.json`。

## 日程文件

当前使用两条独立队列，每天两个时间点，并有不自动追加的公共日程：

```text
work01a.json ... work07a.json   # 工作日/白班批次，08:00 追加
work01b.json ... work07b.json   # 工作/夜班批次，16:00 追加
social01a.json ... social07a.json
social01b.json ... social07b.json
workpub.json / socialpub.json     # 公共日程文件，可由编辑器编辑
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

## 全局变量

文件：`global_variables.json`。顶层必须是数组，每项包含：

```json
[
  { "id": 0, "name": "是否取得钥匙", "type": "bool", "default": false },
  { "id": 1, "name": "调查进度", "type": "number", "default": 0 },
  { "id": 2, "name": "路线", "type": "string", "default": "" }
]
```

约束：

- ID 是从 0 开始的非负整数，不能重复；定义会按 ID 排序。
- `type` 只能是 `bool`、`number`、`string`。
- `number` 的默认值和运行时值必须在 `0..256`。
- bool 必须使用 JSON 布尔值，字符串必须使用 JSON 字符串。
- `default` 是读档缺少对应值时的回退值。

条件可写在对话节点、选项、日程条目、特殊事件、道具和结局中：

```json
{ "condition": { "id": 0, "equals": true } }
```

```json
{
  "condition": {
    "globalVariables": [
      { "id": 1, "op": "gte", "value": 10 },
      { "id": 2, "equals": "route_a" }
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
    { "id": 2, "value": "route_a" }
  ]
}
```

只有 number 支持 `delta`；其他类型使用 `value`。

## 旧式 dialogueTree（仅兼容读取）

历史数据中的 `dialogueTree` 仍可由 `ScheduleBlueprint.migrateDialogueTree()` 转换，但新内容不得再使用它。HIS、Social 和 Monitor 的正式运行入口都是对象式日程蓝图和共用的 `ScheduleRunner`：

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
        "favorabilityChange": { "npcId": "ajie", "delta": 5 },
        "globalVariables": [{ "id": 1, "delta": 1 }]
      }
    }
  }
}
```

该示例仅用于理解旧数据，不应作为新数据模板。关键词只通过文本中的 `[[keyword_id]]` 引用；新 entry 不要添加额外的 `keywordIds` 代替标记。

## 日程蓝图

新日程可以使用对象式蓝图：`nodes` 是节点 ID 到节点对象的映射，`connections` 保存类型化引脚连接，`startNodeId` 指向唯一的 `flowStart` 节点。流程引脚只能连接流程引脚，数值引脚只能连接数值引脚；一个节点不能同时拥有流程输出和数值输出。旧 `dialogueTree` 会在运行时兼容迁移。

当前注册的 18 种节点包括：`flowStart`、`text`、`choice`、`branch`、`consumeTime`、`setGlobal`、`insertSchedule`、`showCg`、`inventoryOperation`、`statOperation`、`spellOperation`、`arithmetic`、`getGlobal`、`getInventory`、`getProtagonistStat`、`getScheduleStatus`、`getScheduleInstanceCount`、`getGameTime`。

`consumeTime` 是一个流程节点，包含 `flowIn`、`flowOut` 和数值输入 `minutes`。输入必须是非负整数且为 20 分钟的倍数；执行时通过 `TimeService`/`GameState` 推进确定性的游戏时间，并触发现有的阶段、日程和结算检查点。数值输入可以连接运算或取值节点。

`spellOperation` 是一个流程节点，使用节点上的 `spell` 对象调用 `SpellManager.learn()`。法术学习蓝图必须把 `consumeTime(240)` 放在 `spellOperation` 之前；创建蓝图前不得调用 `spellManager.learn()`。

日程队列中的实例使用 `${scheduleId}:${sequence}` 作为稳定实例 ID，并保存 `status`、`currentNodeId` 和 `transcript`。已完成实例可以重复打开并只读查看历史文本，但不会再次执行节点或重新选择。

## 物品

文件：`items.json`，顶层为 `items` 和可选的 `startingInventory`。常用字段：

- `usable`、`consumable`、`inspectText`、`revealKeywordIds`
- `inspectCheck`、`inspectOutcomes`
- `sanVariants`：按主角 SAN 选择描述和关键词
- `inspectTimeAdvance`：调查覆盖时间，默认行动时间为 20 分钟
- `useCondition.requires`：物品数量条件
- `useCondition.sanMin` / `sanMax`：SAN 条件
- `useCondition.globalVariables`：全局变量条件
- `useEffect.remove` / `add` / `statChanges` / `npcSanChanges` / `npcOffline` / `timeAdvance` / `ending`
- realtime 操作使用运行时 effect：ChatGTP 可使用 `npcSanChanges`，HIS 使用 `medicalSubmission`，NPC 离线使用 `npcOffline`；这些 effect 与同一实例的时间推进一起执行。
- `useEffect.globalVariables`：使用成功后的变量效果
- `schedules.inspect` / `schedules.use` / `schedules.obtain` / `schedules.lose`：四类直接嵌套在物品对象中的日程蓝图
- `isBook`、`spells`：可学习法术的书籍

物品调查文本中的关键词标记会传给 `KeywordManager`；显式 `revealKeywordIds` 会自动收集，文本标记则由玩家点击收集。

## 场景物品摆放

`item_placements.json` 将场景摆放状态与背包分开管理。每项可配置位置、关联 `itemId`、初始摆放状态和按日期、phase、location、室友睡眠状态、全局变量决定的可见条件。拾取和放回会分别更新摆放状态与背包。

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
- `special_events.json`：按 NPC、phase、日期、好感度、SAN 和全局变量覆盖日程角色。
- `achievements.json`：监听游戏事件、技能检定、好感度、SAN、阅读文本等条件。

修改稳定 ID 时必须搜索所有日程、对话、特殊事件、关键词、问答、存档索引和开发工具引用。
