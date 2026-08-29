# 运行时架构审计

> 审计依据：`js/core/SaveManager.js` 的 `_encode()` / `_decode()`、各核心单例的状态字段与 `snapshot/restore()`、`js/main.js` 的 App 注册，以及 `js/desktop/DeveloperMode.js` 的调试器入口。
>
> “重要”定义：所有会影响游戏规则、结局、可见世界、可恢复流程或存档一致性的运行时状态均为重要状态；所有实际写入 URL 存档的字段无条件属于重要状态。

## 1. 重要运行时变量与所有者

| 状态域 | 所有者 | 重要变量 | 当前调试器 |
| --- | --- | --- | --- |
| 游戏时间与模式 | `GameState` / `TimeService` | `day`、`clockMinutes`、`phase`、`duty`、`location`、`phaseMinutes`、`sleepHistory`、`insufficientSleepStreak`、`energy`、`mental`、`physical`、`satiety`、`recoverableMentalLoss` | 时间与读档 |
| 工作/社交/ChatGTP/主要流程 | `ScheduleQueue` | `workQueue`、`socialQueue`、`mainQueue` 的全部实例：`scheduleId`、`instanceId`、`status`、`payload`、接收时间、transcript 及实例扩展字段 | 无专用队列调试器 |
| 日程来源与动态追加 | `ScheduleData` | `fired`、`pendingAdds`、`lastAbsoluteMinute`、动态日程请求及其目标队列 | 无 |
| 玩家背包 | `ItemManager` | 物品 ID 与持有数量 | 玩家与资源 |
| 场景物品摆放 | `ItemPlacementManager` | 每个 placement 的 `placed` 状态 | 世界与场景 |
| 关键词笔记本 | `KeywordManager` | 已收集关键词 ID、`collectedDay`；定义注册表为静态数据 | 玩家与资源（只读） |
| 法术 | `SpellManager` | 已学习法术完整对象、来源书籍、索引及施放参数 | 玩家与资源（只读） |
| NPC SAN/在线状态 | `NpcStateManager` | 每个 NPC 的 SAN、`offlineActors`、`pendingOfflineActors` | NPC与对话 |
| NPC 好感度 | `FavorabilityManager` | `values`、`hadPositive` | NPC与对话 |

| HIS/医疗流程 | `MedicalCaseManager` | `submissions`、`income`、`pendingIncome`、`pendingExpenses`、`settledDays`、`pendingIncidents` | 医疗与结局 |
| 全局变量当前值 | `GlobalVariableManager` | 每个定义 ID 对应的当前 `value` | 世界与场景 |
| 结局锁定状态 | `EndingManager` | `_ended` | 医疗与结局 |
| 成就跨周目状态 | `AchievementManager` | 成就解锁、时间、进度、已读状态、`_sanEverLow`、`_readNodeIds` | 无；故意使用 localStorage 跨周目保存 |
| BGM 播放层 | `BgmManager` | 当前轨道、对话 BGM 栈、结局 BGM、淡出/待播放状态 | 无；主要为临时表现状态 |
| 窗口布局 | `WindowManager` | 已打开 appId、窗口 x/y 及窗口顺序 | 时间与读档中的读档恢复间接覆盖 |
| 数据加载缓存 | `DataLoader` | JSON 缓存与开发服务器缓存失效状态 | 无；基础设施状态，不属于游戏调试器 |

## 2. 当前 URL 存档实际保存的运行时变量

`SaveManager` 当前格式为 v15，`_encode()` 保存以下域：

1. **`gameState`**：`day`、`clockMinutes`、`phase`、`duty`、`location`、`energy`、`mental`、`physical`、`satiety`、`recoverableMentalLoss`。
2. **`timeService`**：`phaseMinutes`、最近三次 `sleepHistory`、`insufficientSleepStreak`。
3. **`workQueue`**：完整实例数组及 transcript。
4. **`socialQueue`**：完整实例数组及 transcript。
6. **`mainQueue`**：完整实例数组及 transcript。
7. **`keywords`**：已收集关键词的 `id`、`collectedDay`。
8. **`inventory`**：物品 `id`、`count`，以及当前实现中附带的 `def` 静态定义对象。
9. **`medical`**：`income`、`pendingIncome`、`pendingExpenses`、`settledDays`、`submissions`、`pendingIncidents`。
10. **`npcState`**：NPC SAN 映射、已离线 NPC、待离线 NPC。
11. **`globalVariables`**：每个全局变量的 `id` 与当前 `value`。
12. **`windows`**：打开窗口的 `appId`、`x`、`y`。
13. **`spells`**：已学习法术完整对象数组。
14. **`scheduledAdds`**：动态日程的 `scheduleId`、`addTime`、可选 `queueId`。
15. **`favorability`**：NPC 好感度值和 `hadPositive`。
16. **`itemPlacements`**：场景物品的 `placed` 状态。

18. **`ending`**：结局是否已经锁定。
19. **`cg`**：当前 CG 的 `activeCgId`。

以上所有字段均为重要运行时状态。当前解码路径逐项恢复这些字段；不应把窗口布局、静态定义副本或实例 transcript 当成可忽略的临时数据。

## 3. 已修复的存档缺口与仍需后续决策的状态

历史审计发现的存档缺口已在 v13–v15 期间补齐：

- `FavorabilityManager`：好感度 `values` 与 `hadPositive`，保存键为 `favorability`。
- `ItemPlacementManager`：场景物品 `placed` 映射，保存键为 `itemPlacements`。

- `EndingManager`：结局锁定状态，保存键为 `ending`。

这些状态均由各自 owner 的 `snapshot/restore()` 负责，SaveManager 只负责编排保存和恢复顺序。

`EndingManager._ended` 由当前 `ending.ended` 保存并恢复；CG 当前状态由 `cg.activeCgId` 保存并恢复。开发调试器提供重置和触发操作，仍遵循 EndingManager 的首个结局规则。

成就状态和设置不是 URL 游戏存档：

- `AchievementManager` 使用 localStorage，故意跨周目持久化。
- `SettingsManager` 使用 localStorage，属于用户偏好，不属于单局游戏状态。

## 4. 已有调试器覆盖

### 时间与读档

当前入口已重命名为“时间与读档”，图标为时钟 `🕒`。现有能力：

- 粘贴并载入存档字符串。
- 修改第几日、时、分和地点。
- 通过 `TimeService.debugSetTime()` 调整时间。
- 强制结束当前工作批次。

它覆盖了 `GameState` 的基础时间/模式字段，以及 `TimeService` 的阶段分钟、睡眠历史和睡眠不足连续天数观察。

### NPC与对话

当前覆盖：

- NPC 与 ChatGTP 的 SAN。
- NPC 离线状态。
- 三名核心角色的好感度。
它现在以“NPC状态”为入口；对话进度与状态由日程实例及其队列调试信息管理。

### 玩家与资源

当前覆盖：

- 增加物品。
- 减少一个物品。
- 清空某物品。
- 修改玩家 energy、mental、physical、satiety。
- 只读查看已学习法术和已收集关键词。

它覆盖 `GameState` 和 `ItemManager.inventory`，场景物品由“世界与场景”负责。

### 日程与队列、世界与场景、医疗与结局

三个新增入口分别覆盖三个队列及实例状态、场景物品/全局变量当前值，以及 HIS 医疗账目/提交和结局锁定状态。

## 5. 仍未提供独立调试器的状态

以下状态仍没有独立入口，或仅以只读方式呈现在组合调试器中：

1. `ScheduleData.fired`、`pendingAdds`、`lastAbsoluteMinute` 尚未在“日程与队列”中单独展示。
2. `KeywordManager` 和 `SpellManager` 当前只读展示，尚未提供独立的运行时增删控件。
3. `FavorabilityManager.hadPositive` 尚未单独展示，但已随 NPC 与对话调试器和当前 v15 存档覆盖。
4. `BgmManager` 的对话栈和结局 BGM 层（通常属于表现层，不建议优先开放）。

## 6. 推荐的调试器分组

### A. 时间与读档

保留现有名称和入口，负责：

- `GameState.day/clockMinutes/phase/duty/location`。
- `TimeService.phaseMinutes/sleepHistory/insufficientSleepStreak`。
- 存档字符串载入与当前存档导出。
- 强制下班、阶段边界和最终阶段观察。

### B. 日程与队列

新增一个运行时调试器，统一观察但分栏显示：

- `workQueue`、`socialQueue`、`mainQueue`。
- 每个实例的 `instanceId`、`scheduleId`、状态、收到时间和 transcript。
- 标记 resolved、重放/清除单个实例、查看 `pendingAdds`。

清除和重放必须明确标记为开发操作，不能绕过正常执行器；优先提供只读观察，修改操作应使用实例 ID。

### C. 玩家与资源

把玩家侧可变资源放在一起：

- `energy`、`mental`、`physical`、`satiety`、`recoverableMentalLoss`。
- `ItemManager.inventory`。
- `SpellManager.spells`。
- `KeywordManager.collected`。

玩家数值已经从“时间与读档”中删除；若未来恢复调节入口，应在此新分组提供，而不是放回时间调试器。

### D. NPC 与对话

保留现有 NPC 调节器并明确拆成子面板：

- NPC SAN、在线/离线、pendingOffline。
- `FavorabilityManager.values/hadPositive`。


### E. 世界与场景

新增或并入玩家与资源之外的世界状态：

- `ItemPlacementManager.placed`。
- 当前地点/场景可见物品。
- 全局变量当前值。
- 日历派生的休息日/夜班日只读信息。

### F. 医疗与结局

适合独立成组，因为状态结构和后果都较复杂：

- 医疗提交、诊断、用药、收入、待结算支出。
- `pendingIncidents`。
- 结局触发锁定与最终结局条件观察。

### G. 仅观察的表现/基础设施

不建议作为首批可修改调试器，但可提供只读诊断：

- BGM 当前解析层、对话 BGM 栈。
- 窗口实例与 z 顺序。
- DataLoader 缓存和开发服务器连接状态。

## 7. 当前后续工作建议

存档缺口和基础调试器分组已经完成；后续工作不应再按旧的 v12 存档计划执行。当前仍适合优先处理的项目是：

1. 在“日程与队列”中补充 `ScheduleData.fired`、`pendingAdds` 和
   `lastAbsoluteMinute` 的只读观察（如调试需求仍然存在）。
2. 为关键 owner 补充确定性的 save round-trip 和队列恢复探针，特别是
   CG 状态、动态日程与对话 checkpoint。
3. 视表现层调试需求增加 BGM 栈、窗口 z 顺序和 DataLoader 缓存的只读诊断。
