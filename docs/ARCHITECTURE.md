# 架构说明

## 项目定位

`surrounded by cultists`（《完蛋，我被邪教徒包围了！》）是一个纯原生 ES6 模块、无构建步骤、无框架、无 `package.json` 的数据驱动网页游戏。浏览器加载 `index.html`，游戏逻辑从 `data/<language>/` 加载 JSON。

## 启动与组成根

`js/main.js` 是组成根，负责：

1. 从 `SettingsManager` 读取语言并配置 `DataLoader`。
2. 并行预加载 i18n、物品、日程、结局、存档索引、技能、时间规则、NPC、成就、医疗和全局变量。
3. 注册 `APP_REGISTRY`，由 `Desktop` 和 `Taskbar` 共同渲染桌面图标、开始菜单和任务栏。
4. 挂载 `WindowManager`、`DormMode`、通知、结局界面和成就提示。
5. 在普通 URL 显示主菜单；带存档查询串时恢复存档；严格为 `?dev` 时启用开发人员模式。
6. 导入 `SpellLearnDialog.js` 的副作用订阅，使书籍使用事件可以打开法术学习窗口。

## 状态与事件

核心对象采用“类 + 单例”导出模式。跨模块变化优先通过 `js/core/EventBus.js` 广播。

| 模块 | 责任 |
| --- | --- |
| `GameState` | 日期、绝对游戏时钟、昼夜 phase、duty/location、精力、SAN、体力、饱腹 |
| `DayNightSystem` | 上班、下班、睡眠、工作日/休息日和最终阶段切换 |
| `TimeService` | 唯一普通游戏时间推进、跨日和阶段结算 |
| `ScheduleData` | 加载 work/social 日程，并按时间点追加批次 |
| `ScheduleQueue` | 独立的 `workQueue`、`socialQueue`、`chatgtpQueue` 和非阻塞 `mainQueue` |
| `ItemManager` | 物品定义、背包、调查、使用条件和使用效果 |
| `ItemPlacementManager` | 场景中的条件物品摆放、拾取和放回 |
| `GlobalVariableManager` | 数据定义的 bool/number/decimal/string 全局变量、条件和效果 |
| `SpellManager` | 已学习法术、法术施放和法术状态事件 |
| `KeywordManager` | 关键词注册、收集、来源和笔记本数据 |
| `ScheduleRunner` | HIS/Social/Monitor 对话及所有对象式日程蓝图执行器 |
| `DialogueEffects` | 对话显示时的物品、NPC、好感度、结局、变量和游戏事件效果 |
| `EndingManager` | 事件、对话、物品、属性阈值和最终阶段结局 |
| `SaveManager` | v13 存档编码/恢复、窗口布局、队列实例和所有持久状态 |
| `DeveloperMode` | 仅源码开发版中的时间与读档、玩家与资源、NPC与对话、日程/世界/医疗调试器、JSON/内容编辑和日程蓝图编辑 |

典型事件流：

```text
用户操作
  -> App / Mode
  -> 核心单例
  -> EventBus
  -> 其他核心单例和已打开窗口
```

常见事件包括：`gamestate:changed`、`time:changed`、`daynight:changed`、`schedule:triggered`、`schedule:resolved`、`schedule:completed`、`item:inspected`、`item:used`、`spells:changed`、`spell:cast`、`global-variable:changed`、`global-variables:changed`、`ending:triggered`。

## 统一日程执行边界

日程实例是所有普通计时操作和可持久化副作用的唯一执行身份。应用只创建实例、提供展示回调，不直接推进时间或提交状态：

| 操作 | 队列 | 执行顺序 |
| --- | --- | --- |
| HIS/Social/Monitor 对话 | `workQueue` / `socialQueue` / `mainQueue` | `ScheduleRunner` 执行蓝图节点、对话效果和 `consumeTime` |
| ChatGTP 关键词查询 | `chatgtpQueue` | 扣 NPC SAN、推进 20 分钟、提交回答 |
| 物品调查/使用、法术施放 | `mainQueue` | `ItemScheduleRuntime` 执行效果、时间和完成事件 |
| HIS 诊断提交 | `mainQueue` | 提交医疗记录、推进 20 分钟、完成实例 |
| 法术学习 | `mainQueue` | `consumeTime(240)` 后执行 `spellOperation` |
| NPC 离线 | `mainQueue` | 执行离线状态转换和 `offlineConsequence` |

`TimeService` 是唯一的普通时间推进 owner。睡眠、醒来、下班、跨日、日结和最终结局是显式系统边界；其中医疗到期只在 `TimeService` 的醒来路径调用 `MedicalCaseManager.processDue()`，医疗管理器不得再通过 `daynight:changed` 自行执行该逻辑。EventBus listener 若改变状态或消耗时间，必须视为执行器审计，不能当作被动通知。

法术学习的状态变更不得发生在创建日程之前：学习按钮只构造 spell 数据并创建蓝图，蓝图先消耗 240 分钟，随后由 `spellOperation` 调用 `SpellManager.learn()`。NPC SAN 跨过离线阈值时只登记 pending 状态并创建一个带 instance ID 的 realtime 日程；只有该日程执行到离线节点时才加入 `offlineActors` 并发出离线通知。

## 游戏时间与状态机

- 初始状态：第 1 天 `08:00`，`phase=day`、`duty=on-duty`、`location=work`。
- 游戏天数范围为第 1 至第 7 天；第 7 天最终阶段结束后解析结局，不进入第 8 天。
- 工作窗口：`08:00 <= clock < 16:00`。
- 天文白昼：`06:00 <= clock < 18:00`；仅用于场景/氛围判断，不替代工作 phase。
- 夜间睡觉窗口：`16:00` 到次日 `08:00`；跨越午夜时日期立即增加。
- 普通成功行动默认推进 20 分钟；行动数量没有上限。计时操作不得在 App 中直接调用 `TimeService.advanceBy()`。
- 在工作窗口结束工作会把时钟推进到 `16:00`，但不是一次普通行动。
- 睡眠到次日 `08:00` 时结算医疗收入/支出、SAN 恢复和睡眠债。
- 当前批次未完成时不能下班或睡觉；显式空 `entries: []` 表示没有待完成工作。
- `phase`、`duty`、`location` 是不同概念，恢复存档时会校验它们的一致性。

## 数据加载与缓存

`DataLoader.loadJSON(filename)` 只接受语言相对文件名，例如 `items.json`，不要在代码中硬编码 `data/zh-hans/`。普通玩家版本直接 fetch；开发人员模式在检测到同源 `dev-server.js` 后改走 `/api/file`，并可清除缓存重新读取。

## 开发人员模式边界

所有浏览器端开发工具代码必须放在以下标记中：

```text
// DEV-TOOLS:START
// DEV-TOOLS:END
```

CSS/HTML 使用对应的注释形式。开发人员模式只在 URL 查询串严格等于 `?dev` 时启用。它不是安全认证；开发服务器只能绑定本机。

## 发布流程

```bash
node publish.js
```

脚本会生成 `publish/`，复制玩家文件，并移除所有 `DEV-TOOLS` 区块，同时排除 `.git`、`publish`、`publish.js`、`dev-server.js` 和 `node_modules`。发布版不应包含开发服务器或开发人员入口。
