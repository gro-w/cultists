# surrounded by cultists（完蛋，我被邪教徒包围了！）

一款 Windows 95 风格、纯原生 ES6、无构建步骤的数据驱动网页互动游戏。玩家白天在 HIS 中处理医院工作，非工作时间回到宿舍与 NPC 交流、调查物品、收集关键词并推进剧情。

## 特性

- 原生 HTML/CSS/ES6 modules，无框架、无 bundler、无 `package.json`。
- JSON 驱动的日程、对话、关键词、物品、医疗、结局、成就和全局变量。
- 工作/宿舍双模式，独立的工作、社交、ChatGTP 与 realtime 日程队列。
- 确定性的游戏时钟：普通行动默认推进 20 分钟，跨日和睡眠在明确边界处理。
- 物品调查、SAN 变体、技能检定、条件摆放和使用效果。
- 法术学习/施放系统与关键词笔记本的法术标签页。
- `?dev` 开发人员模式，以及可直接写入数据文件的本地开发服务器。

## 本地运行

只读运行：

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

开发运行（推荐编辑数据时使用）：

```bash
node dev-server.js
```

打开：

```text
http://127.0.0.1:8000/
http://127.0.0.1:8000/?dev
```

开发服务器 API、写盘行为和安全边界见 [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)。

## 游戏规则摘要

- 初始状态为第 1 天 `08:00`，工作模式、`on-duty`、地点 `work`。
- 工作窗口为 `[08:00, 16:00)`；下班进入宿舍/夜间 phase。
- 非工作时间睡觉会在次日 `08:00` 结算并醒来；跨过午夜时日期立即增加。
- 白昼判断为 `[06:00, 18:00)`，与工作 phase 独立。
- 当前工作批次未完成时不能下班；当前夜班批次未完成时不能睡觉。
- 当前日历为 30 天；休息日是第 5、10、15、20、25、30 天；夜班值班日是第 7、11、14、18、22、27、28 天。

## 项目结构

```text
index.html                 入口、桌面、宿舍、主菜单和结局界面
css/                       Win95、应用、模式和开发工具样式
js/main.js                 组成根、应用注册和启动流程
js/core/                   状态、时间、数据、事件、存档和内容系统
js/apps/                   HIS、Social、Monitor、ChatGTP、Notebook 等应用
js/desktop/                桌面、任务栏、宿舍、菜单、结局和开发工具
data/zh-hans/              当前语言的全部游戏数据
dev-server.js              本地静态 + JSON REST + SSE 开发服务器
publish.js                 移除开发工具区块的玩家版发布脚本
docs/                      架构、数据 schema 和协作指南
```

## 核心系统

| 系统 | 责任 |
| --- | --- |
| `GameState` / `DayNightSystem` | 玩家状态、游戏时钟、上下班、睡眠和日结 |
| `TimeService` | 唯一普通游戏时间推进与阶段结算 owner |
| `ScheduleData` / `ScheduleQueue` / `ScheduleRunner` | 按时间加载内容，维护 work/social/chatgtp/realtime 队列并执行统一日程 |
| `ItemManager` / `ItemPlacementManager` | 背包、物品调查、物品使用和场景物品 |
| `GlobalVariableManager` | bool、0–256 number、string 全局变量的条件和效果 |
| `SpellManager` | 已学习法术和 SAN 消耗的施放 |
| `DialogueRunner` / `DialogueEffects` | 共享对话树、条件和显示时副作用 |
| `KeywordManager` / `NotebookApp` | 关键词收集、来源、查询和法术笔记本 |
| `SaveManager` | v11 存档、全局变量、法术和窗口布局恢复 |
| `DeveloperMode` / `dev-server.js` | 开发调试、数据编辑和本地写盘 |

模块间优先通过 `EventBus` 通信；内容相关逻辑应放入 JSON，而不是硬编码在应用中。

## 统一日程架构

所有会改变游戏时间或产生可持久化游戏副作用的玩家操作都必须先进入日程系统。普通对话由对应的 work/social 队列执行；ChatGTP 查询进入 `chatgtpQueue`；物品调查/使用、HIS 诊断提交、法术施放、法术学习和 NPC 离线进入非阻塞 `realtimeQueue`（ChatGTP 使用其专用队列）。

一个操作的时间消耗、状态副作用和完成标记必须由同一个日程实例完成。法术学习蓝图严格先执行 `consumeTime(240)`，再执行 `spellOperation`；NPC 离线由阈值变化创建 realtime 实例，在实例中执行离线状态与配置后果。应用层只负责创建实例和显示结果，不能直接调用 `TimeService.advanceBy()`、直接修改法术/医疗/NPC 状态来模拟日程。

睡眠、醒来、下班、跨日、日结和最终阶段是明确的系统边界，由 `TimeService`/`DayNightSystem` 统一处理，不属于普通叙事日程。医疗到期处理只由 `TimeService` 在醒来边界调用；`MedicalCaseManager` 不再订阅 `daynight:changed`。

## 内容制作入口

- 日程：`work01a.json`/`work01b.json`、`social01a.json`/`social01b.json`，直至第 30 天。
- 全局变量：`global_variables.json`，顶层为数组，ID 唯一且从 0 开始。
- 物品：`items.json`，支持调查、SAN 变体、技能检定、使用条件、状态效果和书籍法术。
- 场景物品：`item_placements.json`。
- 对话、关键词、ChatGTP、NPC、特殊事件、结局、成就和医疗数据见对应 JSON。

完整字段、示例和引用约束见 [`docs/DATA-SCHEMAS.md`](docs/DATA-SCHEMAS.md)。架构和状态机见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

## 验证与发布

项目没有测试框架。修改后至少执行：

```bash
for f in $(git ls-files '*.js'); do node --check "$f"; done
git diff --check
node publish.js
node --check publish/js/main.js
```

JSON 文件用 Python `json.load()` 全量校验。`publish.js` 会删除 `DEV-TOOLS` 区块、排除 `dev-server.js`，发布版不支持开发人员入口。