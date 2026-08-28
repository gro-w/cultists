# 数据 Schema 与内容制作

所有游戏内容放在 `data/<language>/`，运行时代码只通过 `DataLoader` 按 ID 读取。除 UI 外壳文本外，不要把剧情、关键词内容、角色名或物品效果硬编码进应用。

## 语言文件

- `data/languages.json`：可用语言列表。
- `data/strings.<lang>.json`：UI 外壳、按钮、通知和菜单文本。
- `data/<lang>/`：该语言的完整游戏内容副本。

新增语言必须复制全部内容文件，包括所有 `workXXa/b.json`、`socialXXa/b.json`、`global_variables.json`、`item_placements.json` 和 `items.json`。

## 日程文件

当前使用两条独立队列，每天两个时间点：

```text
work01a.json ... work30a.json   # 工作日/白班批次，08:00 追加
work01b.json ... work30b.json   # 工作/夜班批次，16:00 追加
social01a.json ... social30a.json
social01b.json ... social30b.json
```

文件最小结构：

```json
{ "entries": [] }
```

`entries` 中的患者放在 `patients`，社交角色放在 `contacts`。NPC 联系人使用稳定 `npcId`，自定义角色使用 `type: "other"`、`name` 和 `avatar`。条目可带 `condition` 或 `globalVariableCondition`。

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

## 对话树

HIS、Social 和 Monitor 使用共用的 `DialogueRunner`：

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

关键词只通过文本中的 `[[keyword_id]]` 引用；不要为角色添加额外的 `keywordIds` 代替标记。终点节点应保留 `options: []`。

## 物品

文件：`items.json`，顶层为 `items` 和可选的 `startingInventory`。常用字段：

- `usable`、`consumable`、`inspectText`、`revealKeywordIds`
- `inspectCheck`、`inspectOutcomes`
- `sanVariants`：按主角 SAN 选择描述和关键词
- `inspectTimeAdvance`：调查覆盖时间，默认行动时间为 20 分钟
- `useCondition.requires`：物品数量条件
- `useCondition.sanMin` / `sanMax`：SAN 条件
- `useCondition.globalVariables`：全局变量条件
- `useEffect.remove` / `add` / `statChanges` / `timeAdvance` / `ending`
- `useEffect.globalVariables`：使用成功后的变量效果
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

## 结局、特殊事件和成就

- `endings.json`：结局定义、属性阈值、最终阶段条件和默认结局。
- `special_events.json`：按 NPC、phase、日期、好感度、SAN 和全局变量覆盖日程角色。
- `achievements.json`：监听游戏事件、技能检定、好感度、SAN、阅读文本等条件。

修改稳定 ID 时必须搜索所有日程、对话、特殊事件、关键词、问答、存档索引和开发工具引用。
