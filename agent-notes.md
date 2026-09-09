# agent-notes.md

本文件保存项目背景、实现索引、命令示例和详细参考信息。真正需要遵守的项目规则位于 `AGENTS.md`；开始工作前阅读 `AGENTS.md`，需要背景或实现索引时再参考本文件。

## 项目概览

- 项目是 `surrounded by cultists`（《完蛋，我被邪教徒包围了！》）。
- 使用原生 HTML/CSS/ES6 modules；无构建步骤、无框架、无 `package.json`。
- `index.html` 是唯一浏览器入口，模拟 Win95 桌面、任务栏、开始菜单、应用窗口和宿舍模式。
- 游戏内容放在 `data/<lang>/` 的 JSON 中；代码只引用稳定 ID。

## 开发服务器和启动示例

只读静态服务器：

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

开发服务器（支持开发人员模式直接写 JSON）：

```bash
node dev-server.js
node dev-server.js --port 8001 --lang zh-hans
```

打开 `http://127.0.0.1:8000/?dev`（或实际端口）。`dev-server.js` 只绑定本机，没有认证。

开发服务器 API：

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| `GET` | `/api/files` | 列出 `data/<lang>/` 中的 JSON |
| `GET` | `/api/file?f=<name>` | 读取已存在的 JSON |
| `POST` | `/api/file?f=<name>` | 校验 JSON 后原子覆盖已存在文件 |
| `GET` | `/api/events` | SSE 文件变化通知 |

开发模式启动后，`DataLoader` 会探测 `/api/files`；探测成功时从 API 读取数据。`DeveloperMode` 的「写入磁盘」按钮调用 POST，SSE 会清理 DataLoader 缓存。浏览器端没有权限写任意新文件；服务器端路径穿越也会被拒绝。

## NG 引擎能力说明

NG 游戏引擎提供以下基础能力：

1. 仿 Windows 95 的桌面和自定义窗口系统
2. 基于蓝图的 Activity 运行系统
3. 存档系统
4. 开发人员模式

成就、物品、患者、宿舍、日历、室友剧情、结局、应用和患者队列属于 Cultists 内容层，而不是引擎内置业务。业务由 `ng/content/` 内容包中的数据结构、自定义窗口和自定义 Activity/管理器 Activity 组成。

`ng/engine.js` 是平台入口，负责加载内容包并启动平台。内容包组合引擎提供的通用桌面、窗口、Activity、时间推进和存档 API。

开发人员模式的桌面入口和开始菜单入口由开发环境代码提供。业务成就（例如“我要强制下班”）属于业务数据，可由开发人员模式、JavaScript 控制台或其他调用方触发，并通过存档进入发布版。

## 核心模块索引

核心模块采用 class + singleton 导出方式，例如：

```js
class ExampleManager { /* ... */ }
export const exampleManager = new ExampleManager();
export default ExampleManager;
```

跨模块变化通常通过 `js/core/EventBus.js` 传递。新增核心全局状态需要 owner、snapshot/restore（如需持久化）和事件语义。

| 模块 | 责任 |
| --- | --- |
| `GameState` | day、clockMinutes、phase、duty、location、energy、mental、physical、satiety |
| `DayNightSystem` | 上班/下班/睡眠、工作日/休息日、最终阶段 |
| `TimeService` | 普通游戏时间推进与阶段结算；处理 20 分钟行动、物品/法术时间、睡眠日结 |
| `ScheduleData` | 加载 `workXXa/b` 和 `socialXXa/b`，按时间追加队列 |
| `ScheduleQueue` | 独立 `workQueue`、`socialQueue` 和非阻塞 `mainQueue` |
| `ItemManager` | 物品定义、背包、调查、使用条件/效果 |
| `ItemPlacementManager` | 场景物品摆放、可见条件、拾取/放回 |
| `GlobalVariableManager` | 公共变量定义、值、条件比较、效果、存档快照 |
| `SpellManager` | 学习/施放法术 |
| `KeywordManager` | 关键词定义、收集和笔记本来源 |
| `DialogueRunner` | HIS/Social 共用对话树执行 |
| `DialogueEffects` | 对话节点 onShow 的共享副作用 |
| `EndingManager` | 事件、对话、道具、属性和最终阶段结局 |
| `SaveManager` | URL 存档、公共变量、法术、CG 和窗口布局恢复 |

## 状态机参考

- 初始状态为第 1 天 `08:00`、`phase=day`、`duty=on-duty`、`location=work`。
- 工作窗口为 `[08:00, 16:00)`；天文白昼为 `[06:00, 18:00)`。
- 普通成功行动默认推进 20 分钟。
- 玩家可见的计时操作包括 ChatGTP 查询、HIS 提交、物品调查/使用、法术学习/施放。
- 法术学习活动顺序为 `consumeTime(240)` → `spellOperation` 调整已学习状态。
- 工作/夜班未完成的当前批次分别阻塞下班/睡觉；`entries: []` 是显式空批次。
- 午夜增加游戏日期；到次日 `08:00` 结算一次睡眠、医疗、收入支出和睡眠债。

## 数据参考

完整字段示例见 `docs/DATA-SCHEMAS.md`，状态与事件流见 `docs/ARCHITECTURE.md`。

- UI 外壳字符串使用 `i18n.t()`，语言文件为 `data/strings.<lang>.json`。
- 剧情和内容直接放在语言数据目录。
- 关键词内容来自 `keywords.json`；对话关键词以 `[[keyword_id]]` 标记引用。
- NPC 持久化 ID 使用 `npcId`。
- 公共变量文件顶层是数组；ID 唯一、非负整数；类型包括 `bool`、`number`、`decimal`、`string`；number/decimal 范围为 `0..256`，decimal 精确到小数点后 2 位。
- 公共变量 ID `0..99` 为系统预留；其中 `1` 为主角 SAN、`2` 为金钱、`5` 为 ChatGTP SAN、`20..39` 为主角技能点、`40..59` 为 NPC 好感度、`60..79` 为 NPC SAN。
- 条件支持 `condition`/`globalVariableCondition`、`globalVariables`、`all`、`any` 和 `eq/neq/gt/gte/lt/lte`。
- 公共变量效果使用 `value`，number/decimal 才能使用 `delta`。
- 书籍法术放在物品的 `spells` 数组；学习 240 分钟，施放默认消耗 5 SAN。代码存在不代表当前数据已有法术。

## 开发模式标记示例

仅开发版代码使用以下标记；CSS/HTML 使用相应注释形式：

```text
// DEV-TOOLS:START
// DEV-TOOLS:END
```

开发入口严格判断 `?dev`。新增开发数据编辑器校验 schema；「保存到内存」「下载」「写入磁盘」是不同语义。

## 存档参考

当前 `SaveManager` 格式为 v24，保存游戏状态、TimeService、工作/社交/主要三个队列、医疗、关键词、背包、NPC 状态、好感度、场景物品、结局、公共变量、法术、动态活动、CG 和窗口布局。对话进度与状态由活动实例负责，不再单独保存。

新增可恢复窗口时，需要把 appId 加入 `WINDOW_APP_IDS`，并在 `main.js` 注册 launcher。

## 文档和开发参考

- `docs/DEVELOPMENT.md`：更多命令和协作细节。
- `docs/DATA-SCHEMAS.md`：数据字段示例。
- `docs/ARCHITECTURE.md`：状态与事件流。
