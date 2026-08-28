# 运行时架构审计

> 审计依据：`js/core/SaveManager.js` 的 `_encode()` / `_decode()`、各核心单例的状态字段与 `snapshot/restore()`、`js/main.js` 的 App 注册，以及 `js/desktop/DeveloperMode.js` 的调试器入口。
>
> “重要”定义：所有会影响游戏规则、结局、可见世界、可恢复流程或存档一致性的运行时状态均为重要状态；所有实际写入 URL 存档的字段无条件属于重要状态。

## 1. 重要运行时变量与所有者

| 状态域 | 所有者 | 重要变量 | 当前调试器 |
| --- | --- | --- | --- |
| 游戏时间与模式 | `GameState` / `TimeService` | `day`、`clockMinutes`、`phase`、`duty`、`location`、`phaseMinutes`、`sleepHistory`、`insufficientSleepStreak`、`energy`、`mental`、`physical`、`satiety`、`recoverableMentalLoss` | 时间与读档（部分） |
| 工作/社交/ChatGTP/实时流程 | `ScheduleQueue` | `workQueue`、`socialQueue`、`chatgtpQueue`、`realtimeQueue` 的全部实例：`scheduleId`、`instanceId`、`status`、`payload`、接收时间、transcript 及实例扩展字段 | 无专用队列调试器 |
| 日程来源与动态追加 | `ScheduleData` | `fired`、`pendingAdds`、`lastAbsoluteMinute`、动态日程请求及其目标队列 | 无 |
| 玩家背包 | `ItemManager` | 物品 ID 与持有数量 | 背包控制器 |
| 场景物品摆放 | `ItemPlacementManager` | 每个 placement 的 `placed` 状态 | 无 |
| 关键词笔记本 | `KeywordManager` | 已收集关键词 ID、`collectedDay`；定义注册表为静态数据 | 无运行时调试器 |
| 法术 | `SpellManager` | 已学习法术完整对象、来源书籍、索引及施放参数 | 无 |
| NPC SAN/在线状态 | `NpcStateManager` | 每个 NPC 的 SAN、`offlineActors`、`pendingOfflineActors` | NPC 状态调节 |
| NPC 好感度 | `FavorabilityManager` | `values`、`hadPositive` | NPC 状态调节可修改，但不是独立好感度调试器 |
| 对话恢复位置 | `DialogueProgress` | HIS/Social/ChatGTP 的 `actorId`、`nodeId` | NPC 状态调节器内有入口 |
| HIS/医疗流程 | `MedicalCaseManager` | `submissions`、`income`、`pendingIncome`、`pendingExpenses`、`settledDays`、`pendingIncidents` | 无 |
| 全局变量当前值 | `GlobalVariableManager` | 每个定义 ID 对应的当前 `value` | 定义编辑器兼有当前值控件；应拆出运行时调试器 |
| 结局锁定状态 | `EndingManager` | `_ended` | 无 |
| 成就跨周目状态 | `AchievementManager` | 成就解锁、时间、进度、已读状态、`_sanEverLow`、`_readNodeIds` | 无；故意使用 localStorage 跨周目保存 |
| BGM 播放层 | `BgmManager` | 当前轨道、对话 BGM 栈、结局 BGM、淡出/待播放状态 | 无；主要为临时表现状态 |
| 窗口布局 | `WindowManager` | 已打开 appId、窗口 x/y 及窗口顺序 | 时间与读档中的读档恢复间接覆盖 |
| 数据加载缓存 | `DataLoader` | JSON 缓存与开发服务器缓存失效状态 | 无；基础设施状态，不属于游戏调试器 |

## 2. 当前 URL 存档实际保存的运行时变量

`SaveManager` 当前格式为 v12，`_encode()` 保存以下域：

1. **`gameState`**：`day`、`clockMinutes`、`phase`、`duty`、`location`、`energy`、`mental`、`physical`、`satiety`、`recoverableMentalLoss`。
2. **`timeService`**：`phaseMinutes`、最近三次 `sleepHistory`、`insufficientSleepStreak`。
3. **`workQueue`**：完整实例数组及 transcript。
4. **`socialQueue`**：完整实例数组及 transcript。
5. **`chatgtpQueue`**：完整实例数组及 transcript。
6. **`realtimeQueue`**：完整实例数组及 transcript。
7. **`keywords`**：已收集关键词的 `id`、`collectedDay`。
8. **`inventory`**：物品 `id`、`count`，以及当前实现中附带的 `def` 静态定义对象。
9. **`medical`**：`income`、`pendingIncome`、`pendingExpenses`、`settledDays`、`submissions`、`pendingIncidents`。
10. **`npcState`**：NPC SAN 映射、已离线 NPC、待离线 NPC。
11. **`globalVariables`**：每个全局变量的 `id` 与当前 `value`。
12. **`windows`**：打开窗口的 `appId`、`x`、`y`。
13. **`spells`**：已学习法术完整对象数组。
14. **`scheduledAdds`**：动态日程的 `scheduleId`、`addTime`、可选 `queueId`。

以上所有字段均为重要运行时状态。当前解码路径逐项恢复这些字段；不应把窗口布局、静态定义副本或实例 transcript 当成可忽略的临时数据。

## 3. 存档缺口与需要后续决策的状态

以下对象存在运行时状态及 `snapshot/restore()`，但当前没有进入 `SaveManager._encode()`：

- `FavorabilityManager`：好感度 `values` 与 `hadPositive`。
- `ItemPlacementManager`：场景物品 `placed` 映射。
- `DialogueProgress`：HIS/Social/ChatGTP 当前对话位置；其文件注释明确声称应参与存档，但当前 v12 编解码未实现。

这些不是“无需调试”的状态，而是“重要且当前持久化不完整”的状态。应在后续单独决定：加入 v13 存档，或明确将它们定义为读档后重新计算/清空的非持久状态。若加入存档，必须同时增加恢复校验和确定性 round-trip 探针。

`EndingManager._ended` 也没有存档。它是否需要持久化取决于产品规则：结局后是否允许保存并恢复到结局界面；当前实现没有提供该语义。

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

它覆盖了 `GameState` 的基础时间/模式字段，但尚未提供 `TimeService` 的睡眠历史、睡眠债、阶段分钟等细粒度观察控件。

### NPC 状态调节

当前覆盖：

- NPC 与 ChatGTP 的 SAN。
- NPC 离线状态。
- 三名核心角色的好感度。
- HIS/Social/ChatGTP 对话恢复位置。

它实际上是“NPC 与对话状态”组合调试器，后续可保留组合，但应在界面上分成两个明确分组。

### 背包控制器

当前覆盖：

- 增加物品。
- 减少一个物品。
- 清空某物品。

它覆盖 `ItemManager.inventory`，但不覆盖场景物品摆放，也不直接展示物品相关实时日程。

## 5. 没有调试器的系统

以下系统目前没有专用运行时调试器：

1. 四个日程队列的实例、状态、transcript 和队列清理/完成操作。
2. `ScheduleData.pendingAdds` 动态追加请求、已触发 checkpoint 集合。
3. `ItemPlacementManager.placed` 场景物品摆放状态。
4. `KeywordManager` 已收集关键词及收集日期。
5. `SpellManager` 已学习法术。
6. `MedicalCaseManager` 的 HIS 提交、待结算收入支出和待处理医闹事件。
7. `GlobalVariableManager` 当前值（现有全局变量定义编辑器不应替代运行时调试器）。
8. `EndingManager._ended` 结局锁定状态。
9. `TimeService` 的阶段累计分钟、睡眠历史和睡眠债细节。
10. `FavorabilityManager.hadPositive` 的成就相关辅助状态；好感度数值虽可从 NPC 调试器修改，但该辅助集合没有独立可视化。
11. `BgmManager` 的对话栈和结局 BGM 层（通常属于表现层，不建议优先开放）。

## 6. 推荐的调试器分组

### A. 时间与读档

保留现有名称和入口，负责：

- `GameState.day/clockMinutes/phase/duty/location`。
- `TimeService.phaseMinutes/sleepHistory/insufficientSleepStreak`。
- 存档字符串载入与当前存档导出。
- 强制下班、阶段边界和最终阶段观察。

### B. 日程与队列

新增一个运行时调试器，统一观察但分栏显示：

- `workQueue`、`socialQueue`、`chatgtpQueue`、`realtimeQueue`。
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
- `DialogueProgress` 的 HIS/Social/ChatGTP 恢复位置。

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

## 7. 建议的实现优先级

1. 先完成“时间与读档”现有界面的名称、图标和功能裁剪。
2. 为存档缺口建立 v12 round-trip 探针，确认好感度、场景物品和对话位置是否应持久化。
3. 优先新增“日程与队列”只读调试器，因为它最容易暴露阻塞、重复执行和恢复问题。
4. 再将全局变量当前值从数据库定义编辑器中明确拆到“世界与场景”运行时调试器。
5. 最后补充医疗/结局调试器和表现层只读诊断。
