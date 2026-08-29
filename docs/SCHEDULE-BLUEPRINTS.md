# 日程蓝图语法与节点参考

本文档描述当前项目实际实现的对象式日程蓝图。节点定义以
`js/core/ScheduleNodeRegistry.js` 为准；校验规则以
`js/core/ScheduleBlueprint.js` 为准；运行时行为以
`js/core/ScheduleRunner.js` 和 `js/core/ScheduleValueEvaluator.js` 为准。
如果本文档与代码不一致，应先修正文档或代码的契约，不要依赖未注册的
节点、端口或字段。

## 1. 蓝图是什么

蓝图是一个有向图，由流程节点、数值节点和两种类型的连接组成。普通日程
文件的一个条目通常把蓝图放在 `dialogueTree` 字段；物品等宿主对象则把蓝图
放在 `schedules.investigate`、`schedules.use`、`schedules.obtain` 或
`schedules.lose` 中。

最小蓝图如下：

```json
{
  "startNodeId": "start",
  "nodes": {
    "start": {
      "id": "start",
      "type": "flowStart",
      "inputs": {},
      "outputs": {}
    },
    "end": {
      "id": "end",
      "type": "scheduleEnd",
      "inputs": {},
      "outputs": {}
    }
  },
  "connections": [
    {
      "fromNodeId": "start",
      "fromPort": "flowOut",
      "toNodeId": "end",
      "toPort": "flowIn"
    }
  ]
}
```

## 2. 顶层语法

### 2.1 `startNodeId`

`startNodeId` 是流程入口节点 ID，必须指向唯一的 `flowStart` 节点。旧数据中
的 `start` 字段只在规范化/迁移边界兼容；新数据应使用 `startNodeId`。

### 2.2 `nodes`

`nodes` 是对象映射：键是节点 ID，值是节点对象。

```json
"nodes": {
  "start": {
    "id": "start",
    "type": "flowStart",
    "inputs": {},
    "outputs": {},
    "x": 80,
    "y": 80
  }
}
```

要求：

- 节点映射键必须与节点的 `id` 相同；
- `type` 必须在本文档的节点列表中注册；
- `inputs` 用于保存常量输入；
- `outputs` 是编辑器/数据兼容字段，实际流程连接写在顶层
  `connections` 中；
- `x`、`y` 是编辑器坐标，不参与游戏语义；零坐标必须保留；
- 节点可额外保存类型专属字段，例如 `text`、`options`、`onShow`、
  `keywordIds` 或 `spell`，但运行时只读取该节点类型定义的字段。

### 2.3 `connections`

每条连接都使用以下格式：

```json
{
  "fromNodeId": "sourceNode",
  "fromPort": "flowOut",
  "toNodeId": "targetNode",
  "toPort": "flowIn"
}
```

连接方向永远是“输出 → 输入”。连接分为两种，不能混用：

1. **流程连接（flow）**：控制下一个执行的节点。
2. **数值连接（value）**：为目标节点的某个输入提供数值、字符串或其他值。

流程连接的运行方向是 `fromNodeId/fromPort → toNodeId/toPort`。数值连接
虽然仍按相同格式保存，但运行时在读取目标输入时，沿
`toNodeId/toPort → fromNodeId/fromPort` 反向求值。

同一个流程输出最多连接一个下游；流程输入可以接收多个上游，用于分支汇合。
一个数值输入通常只应有一个上游连接。连接的端口名称、类型和动态分支范围
必须由节点注册表验证。

### 2.4 常量输入与数值输入

没有上游数值连接时，节点从 `inputs` 读取常量：

```json
"inputs": {
  "statId": "satiety",
  "delta": 6
}
```

也可以在输入中保存兼容形式的值引用：

```json
"inputs": {
  "value": { "nodeId": "san", "port": "value" }
}
```

新数据更推荐使用顶层类型化连接表达引用：

```json
"connections": [
  {
    "fromNodeId": "san",
    "fromPort": "value",
    "toNodeId": "segment",
    "toPort": "value"
  }
]
```

数值节点只能提供 `value` 输出。流程节点不提供数值输出；数值节点也不能
作为流程节点直接跳转。

### 2.5 动态端口

`choice` 和 `segmentBranch` 的端口数量由节点的 `inputs.branchCount` 决定。
动态端口不是任意字符串：数量改变时必须同步删除越界端口、越界连接以及
越界的兼容数据。

### 2.6 节点条件与显示效果

部分节点支持通用的：

```json
"condition": { "...": "..." }
```

或：

```json
"globalVariableCondition": { "...": "..." }
```

运行器在进入节点前检查条件；条件不满足时结束当前日程。`text` 等显示节点
还可以使用：

```json
"onShow": {
  "ending": "ending_id"
}
```

`onShow` 是节点显示/执行时应用的对话效果，具体字段见
`DialogueEffects.js`。结束节点也可以使用 `onShow.ending` 触发结局。

## 3. 节点类型总览

当前注册了 23 种节点：

| 类型 | 类别 | 作用 |
| --- | --- | --- |
| `flowStart` | 流程 | 流程入口 |
| `scheduleEnd` | 流程 | 结束日程 |
| `text` | 流程/显示 | 显示一行文字并等待继续 |
| `choice` | 流程/交互 | 显示选项并按选择分支 |
| `branch` | 流程 | 按布尔条件分支 |
| `waitUntil` | 流程 | 条件为真前阻塞，变为真后继续 |
| `diceCheck` | 流程 | 执行百分骰检定 |
| `consumeTime` | 流程/状态 | 推进游戏时间 |
| `setGlobal` | 流程/状态 | 设置全局变量 |
| `insertSchedule` | 流程/状态 | 向日程队列插入日程 |
| `showCg` | 流程/显示 | 发出显示 CG 事件 |
| `showImage` | 流程/显示 | 发出显示图片事件 |
| `segmentBranch` | 流程 | 按数值区间选择分支 |
| `inventoryOperation` | 流程/状态 | 增减背包物品 |
| `statOperation` | 流程/状态 | 操作主角或其他可写数值 |
| `spellOperation` | 流程/状态 | 调整已学习法术状态 |
| `arithmetic` | 数值 | 执行运算并输出值 |
| `getGlobal` | 数值 | 读取全局变量 |
| `getInventory` | 数值 | 读取背包数量 |
| `getProtagonistStat` | 数值 | 读取主角/游戏数值 |
| `getScheduleStatus` | 数值 | 读取日程实例状态 |
| `getScheduleInstanceCount` | 数值 | 读取日程实例数量 |
| `getGameTime` | 数值 | 读取当前绝对游戏时间 |

下文中的 `flowIn`、`flowOut` 是流程端口；其他端口若标为“值”则是数值
输入或输出。

## 4. 流程节点

### 4.1 `flowStart`：流程起始

- 输入：无；
- 输出：`flowOut`（流程）；
- 作用：蓝图唯一入口；
- 语义：从 `startNodeId` 开始执行，不产生副作用。

### 4.2 `scheduleEnd`：日程结束

- 输入：`flowIn`（流程）；
- 输出：无；
- 作用：结束当前日程实例；
- 语义：设置实例为已解决，清除 `currentNodeId`，触发完成/解决事件。
  如果配置了 `onShow`，结束前仍可应用其显示效果。

### 4.3 `text`：显示文字

- 输入：`flowIn`（流程）；
- 输出：`flowOut`（流程）；
- 值输入：`speaker`、`text`；
- 常用字段：`speaker`、`text`、`onShow`、`keywordIds`；物品调查蓝图可在结果
  文本节点上使用 `keywordIds`，由运行器统一收集关键词并回调调查结果；
- 作用：显示一行文字；
- 语义：记录文本到日程实例 transcript，调用界面回调，然后等待玩家继续。
  没有界面选项容器的实时/无头调用会自动继续。

示例：

```json
{
  "id": "line1",
  "type": "text",
  "inputs": { "speaker": "npc_ajie", "text": "你来了。" },
  "outputs": {}
}
```

### 4.4 `choice`：点击分支

- 输入：`flowIn`（流程）；
- 输出：动态的 `option0` … `optionN-1`（流程）；
- 值输入：`branchCount`（数字）；
- 动态值输入：`label0` … `labelN-1`（字符串）；
- 兼容字段：`options` 或 `branches` 数组；
- 作用：显示玩家选项并进入所选分支；
- 语义：选项可有 `label`、`next`、`condition`、`effects`。条件不满足的选项
  不显示，但仍保留其原始分支索引；选中后应用一次选项效果，再解析对应的
  `optionN` 流程连接。

```json
{
  "id": "choice1",
  "type": "choice",
  "inputs": { "branchCount": 2, "label0": "接受", "label1": "拒绝" },
  "options": [
    { "id": "yes", "label": "接受", "effects": { "favorabilityChange": 1 } },
    { "id": "no", "label": "拒绝" }
  ]
}
```

### 4.5 `branch`：逻辑分支

- 输入：`flowIn`（流程）；
- 输出：`false`、`true`（流程）；
- 值输入：`condition`（任意值，按 JavaScript 布尔规则判断）；
- 作用：按条件选择两个流程出口；
- 语义：真值进入 `true`，假值进入 `false`。

### 4.6 `waitUntil`：阻塞直到

- 输入：`flowIn`（流程）；
- 输出：`flowOut`（流程）；
- 值输入：`condition`（布尔值）；
- 作用：在条件满足前暂停当前日程实例；
- 语义：条件为 `false` 时保留当前节点并阻塞，不执行下游节点；当输入值
  变为 `true` 时结束阻塞，节点只完成一次并沿 `flowOut` 继续。条件来自
  全局变量、主角数值、背包、日程状态等会发出状态变化事件的值时，运行器
  会在相关状态变化后重新求值。该节点不消耗游戏时间。

### 4.7 `diceCheck`：骰子检定

- 输入：`flowIn`（流程）；
- 输出：`largeSuccess`、`success`、`failure`、`largeFailure`（流程）；
- 值输入：`n`（数字，目标值限制在 1–100）；
- 作用：执行百分骰检定；
- 语义：使用运行器的随机源。结果为：
  - `roll <= n / 5`：`largeSuccess`；
  - `roll <= n`：`success`；
  - `roll === 100`，或目标值小于 50 且 `roll >= 96`：`largeFailure`；
  - 其他情况：`failure`。

技能检定不再是独立节点。需要按技能值检定时，使用
`getProtagonistStat` 读取技能数值，并将其 `value` 输出连接到本节点的
`n` 输入；这样技能检定和其他任意数值检定共用完全相同的骰子规则。

### 4.8 `consumeTime`：消耗时间

- 输入：`flowIn`（流程）；
- 输出：`flowOut`（流程）；
- 值输入：`minutes`（数字）；
- 作用：通过 `TimeService` 推进游戏时间；
- 语义：只允许通过此节点表达蓝图内的时间推进。普通行动的默认单位是
  20 分钟；具体蓝图可以使用其他明确的分钟数，例如法术学习的 240 分钟。

### 4.8 `setGlobal`：操作公共变量

- 输入：`flowIn`（流程）；
- 输出：`flowOut`（流程）；
- 值输入：`variableId`、`value`；
- 作用：调用 `GlobalVariableManager.set()` 设置全局变量；
- 语义：值的类型和变量 ID 必须符合全局变量定义。

### 4.9 `insertSchedule`：插入日程

- 输入：`flowIn`（流程）；
- 输出：`flowOut`（流程）；
- 值输入：`scheduleId`（字符串）、`addTime`（数字）、`queue`（字符串）；
- 作用：调用 `ScheduleData.addSchedule()` 向指定队列追加日程；
- 语义：插入失败会终止当前节点执行并报告原因。队列应使用项目支持的
  日程队列 ID，例如 `work` 或 `social`，不能凭空创建队列。

### 4.10 `showCg`：显示 CG

- 输入：`flowIn`（流程）；
- 输出：`flowOut`（流程）；
- 值输入：`cgId`（字符串）；
- 作用：发出 `schedule:cg` 事件；
- 语义：事件携带 `cgId` 和当前日程实例 ID；实际图片/界面由订阅者处理。

### 4.11 `showImage`：显示图片

- 输入：`flowIn`（流程）；
- 输出：`flowOut`（流程）；
- 值输入：`image`（字符串）；
- 作用：发出 `schedule:image` 事件并保存当前调查图片；
- 语义：图片应是资源路径字符串，不是 Base64。空字符串表示清除本次图片。

### 4.12 `segmentBranch`：分段分支

这是通用数值分段节点，不绑定 SAN、技能或某件物品。

- 输入：`flowIn`（流程）；
- 输出：动态的 `segment0` … `segmentN-1`（流程）；
- 值输入：`value`、`branchCount`、`boundary0` … `boundaryN`，其中边界
  数量是 `N + 1`；
- `branchCount` 限制为 1–32；
- 边界必须是有限数，并按降序排列；
- 第 `i` 段的区间为：`boundary[i+1] < value <= boundary[i]`；
- 超过最高边界进入第一段，低于或等于最低边界进入最后一段；
- 作用：将任意数值映射到有序区间分支。

例如 `branchCount=3`、边界为 `100, 70, 30, 0` 时：

```text
segment0: 70 < value <= 100
segment1: 30 < value <= 70
segment2: 0 < value <= 30
```

节点必须把数值来源正式连到 `value` 输入，例如：

```json
{
  "fromNodeId": "mentalValue",
  "fromPort": "value",
  "toNodeId": "segment",
  "toPort": "value"
}
```

### 4.13 `inventoryOperation`：操作背包

- 输入：`flowIn`（流程）；
- 输出：`flowOut`（流程）；
- 值输入：`itemId`（字符串）、`count`（整数）；
- 作用：修改背包数量；
- 语义：正数增加，负数移除对应数量，零表示移除该物品的全部持有数量。
  每次增删仍通过 `ItemManager` 的公开方法执行，因此会发布物品变化事件。

### 4.14 `statOperation`：操作主角数值

- 输入：`flowIn`（流程）；
- 输出：`flowOut`（流程）；
- 值输入：`statId`（字符串）、`delta`（数字）；
- 作用：通过统一数值访问层修改一个可写数值；
- 常见 `statId`：`energy`、`mental`、`physical`、`satiety`、
  `recoverableMentalLoss`；
- 其他支持形式：`npcSan:<npcId>`、`favorability:<npcId>`；
- 只读/读取专用：`timeService:phaseMinutes` 不能被修改；
- 语义：调用 `modifyStatValue()`，非法数值或未知 ID 会抛出错误。

使用物品的主角属性变化应使用此节点，例如：

```json
{
  "id": "satietyChange",
  "type": "statOperation",
  "inputs": { "statId": "satiety", "delta": 6 },
  "outputs": {}
}
```

### 4.18 `spellOperation`：调整法术状态

- 输入：`flowIn`（流程）；
- 输出：`flowOut`（流程）；
- 值输入：无注册的固定端口；
- 常用字段：`spell`、`requireNew`；
- 作用：调用 `SpellManager.learn()` 学习节点中指定的法术；
- 语义：默认要求法术尚未学习；若 `requireNew` 为 `false`，重复/无效学习
  不会因为“必须是新法术”而抛错。法术学习蓝图通常先连接一个
  `consumeTime(240)`，再连接此节点。

## 5. 数值节点

数值节点不参与流程跳转，必须通过 `value` 输出连接到流程节点的值输入。
数值求值有缓存和循环依赖检测；数值依赖形成环时会报告循环错误。

### 5.1 `arithmetic`：运算

- 输入：无流程端口；
- 输出：`value`（任意类型）；
- 值输入：`operator`、`left`、`right`；
- 作用：计算两个输入值；
- 支持运算符：
  - 数值：`+`/`add`、`-`/`subtract`、`*`/`multiply`、`/`/`divide`、
    `%`/`modulo`；
  - 字符串：`concat`、`拼接字符串`；
  - 逻辑：`and`/`与`、`or`/`或`、`xor`/`异或`、`not`/`非`；
  - 比较：`>`/`gt`/`大于`、`<`/`lt`/`小于`、`=`/`eq`/`等于`。
- 除法或取模的除数为零会报错；未知运算符会报错。

### 5.2 `getGlobal`：公共变量取值

- 输出：`value`（任意类型）；
- 值输入：`variableId`；
- 作用：读取 `GlobalVariableManager` 中的变量值。

### 5.3 `getInventory`：背包取值

- 输出：`value`（数字）；
- 值输入：`itemId`（字符串）；
- 作用：读取玩家持有的物品数量。

### 5.4 `getProtagonistStat`：主角数值取值

- 输出：`value`（任意类型）；
- 值输入：`statId`；
- 作用：读取主角或共享数值；
-  支持的读取 ID：`energy`、`mental`、`physical`、`satiety`、
  `recoverableMentalLoss`、`npcSan:<npcId>`、`favorability:<npcId>`、
  `timeService:phaseMinutes`、`gameTime`，以及 `skills.json` 中定义的技能 ID。

读取节点与分段节点的标准连接如下：

```json
{
  "fromNodeId": "mentalValue",
  "fromPort": "value",
  "toNodeId": "sanSegments",
  "toPort": "value"
}
```

### 5.5 `getScheduleStatus`：日程状态

- 输出：`value`（数字）；
- 值输入：`instanceId`（字符串）；
- 作用：读取日程实例状态。运行时状态数字映射为：`unresolved/pending=1`、
  `resolved/completed=2`、不存在为 `0`。

### 5.6 `getScheduleInstanceCount`：日程实例数量

- 输出：`value`（数字）；
- 值输入：`scheduleId`（字符串）；
- 作用：统计四个队列中该日程 ID 的实例数量。

### 5.7 `getGameTime`：当前游戏时间

- 输出：`value`（数字）；
- 输入：无；
- 作用：读取绝对游戏时间 `day * 1440 + clockMinutes`；
- 语义：这是读取节点，不会推进时间。

## 6. 条件、效果和常用组合

### 6.1 全局变量条件

条件由全局变量管理器解释，支持单条件、`all`、`any` 和比较操作
`eq`、`neq`、`gt`、`gte`、`lt`、`lte`。条件失败不会执行节点后续副作用，当前
日程直接解决。

### 6.2 使用物品

使用物品先由 `ItemManager` 检查物品存在、`usable`、数量条件、SAN 条件和
全局变量条件；检查成功后只触发 `schedules.use`。蓝图自身负责成功后的操作：

```text
flowStart
  → inventoryOperation（count=-1，移除消耗品）
  → statOperation（例如 satiety +6）
  → consumeTime（若该使用动作有明确时间成本）
  → scheduleEnd
```

不要在同一个使用蓝图中同时保留旧的直接效果字段和节点副作用。

### 6.3 调查物品

调查通常使用以下结构：

```text
flowStart
  → getProtagonistStat
  → segmentBranch / diceCheck（技能检定先用 getProtagonistStat 读取技能值）
  → showImage（可选）
  → text（调查文本，可选 inspection 元数据）
  → statOperation / inventoryOperation / setGlobal（可选）
  → consumeTime
  → scheduleEnd
```

数值读取节点与 `segmentBranch.value` 或 `diceCheck.n` 之间必须是正式的 value 连接，不能只
把一个看似相同的对象写入无连接的输入。

### 6.4 法术学习

法术学习的状态变更必须发生在时间消耗之后：

```text
flowStart → consumeTime(240) → spellOperation → scheduleEnd
```

### 6.5 分支汇合与公共副作用

如果多个分支最终都必须执行同一个时间成本或效果，应先汇合到公共节点，再
执行一次：

```text
segment0 ─┐
segment1 ─┼→ consumeTime → scheduleEnd
segment2 ─┘
```

不要在每条语义相同的分支上重复放置相同的 `consumeTime` 或效果节点。

## 7. 校验规则与失败模式

保存或运行前应满足：

- 恰好一个 `flowStart`；
- `startNodeId` 存在且指向 `flowStart`；
- 至少一个 `scheduleEnd`；
- 所有注册节点的映射键和 `id` 一致；
- 所有流程节点可从起点到达；
- 每个非结束流程节点至少有一个流程后继；
- 每条连接的源节点、目标节点和端口都存在；
- 源/目标端口类型一致；
- 数值连接必须是数值输出到数值输入；
- 动态端口必须符合当前 `branchCount`；
- `segmentBranch` 的边界必须有限且降序；
- 数值依赖不能形成循环；
- 运行时执行不能超过 1000 个节点步骤。

常见错误包括：

- 把 `getProtagonistStat.value` 写在输入对象里，却没有正式连接到目标输入；
- 把流程输出连接到数值输入，或把数值输出连接到流程输入；
- 修改 `branchCount` 后仍保留越界的 `optionN`、`segmentN` 或边界连接；
- 只连接到一个分支出口，导致其他流程节点不可达；
- 把 `timeService:phaseMinutes` 当作可写属性；
- 用 `Date`、浏览器计时器或真实系统时间代替 `consumeTime`；
- 在同一条路径上重复执行相同的时间/效果副作用；
- 为某个特定属性或物品增加专用节点，而已有通用操作节点可以表达该语义。

## 8. 编辑器与运行时约定

蓝图编辑器必须从 `ScheduleNodeRegistry` 生成端口和输入控件；不要在编辑器
中另行硬编码节点端口。保存时应保留节点 ID、连接方向、动态端口数据和坐标。

运行时的权威执行身份是队列中的日程实例，而不是界面 transcript。普通、临时
和实时日程都应经过相应的队列和 `ScheduleRunner` 路径；物品调查/使用使用
`realtimeQueue`。应用层负责创建/触发日程和展示结果，不应绕过蓝图直接推进时间
或重复应用效果。

蓝图变更后至少运行：

```bash
node --check js/core/ScheduleNodeRegistry.js
node --check js/core/ScheduleBlueprint.js
node --check js/core/ScheduleRunner.js
```

并验证所有 JSON、所有蓝图拓扑、动态端口连接和玩家发布边界。
