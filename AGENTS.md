# AGENTS.md

本文件是所有 coding agent 的项目合同。修改前先阅读相关代码、数据 schema 和调用点；不要凭文件名猜接口。

## 项目边界

- 项目是 `surrounded by cultists`（《完蛋，我被邪教徒包围了！》）。
- 使用原生 HTML/CSS/ES6 modules；无构建步骤、无框架、无 `package.json`。
- `index.html` 是唯一浏览器入口，模拟 Win95 桌面、任务栏、开始菜单、应用窗口和宿舍模式。
- 游戏内容放在 `data/<lang>/` 的 JSON 中；代码只引用稳定 ID。
- 所有文本文件必须使用 LF 换行。

## 启动方式

只读静态服务器：

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

开发服务器（支持开发人员模式直接写 JSON）：

```bash
node dev-server.js
node dev-server.js --port 8001 --lang zh-hans
```

打开 `http://127.0.0.1:8000/?dev`（或实际端口）。`dev-server.js` 只绑定本机，没有认证，不得暴露到公网。

## 开发服务器 API

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| `GET` | `/api/files` | 列出 `data/<lang>/` 中的 JSON |
| `GET` | `/api/file?f=<name>` | 读取已存在的 JSON |
| `POST` | `/api/file?f=<name>` | 校验 JSON 后原子覆盖已存在文件 |
| `GET` | `/api/events` | SSE 文件变化通知 |

开发模式启动后，`DataLoader` 会探测 `/api/files`；探测成功时从 API 读取数据。`DeveloperMode` 的「写入磁盘」按钮调用 POST，SSE 会清理 DataLoader 缓存。浏览器端没有权限写任意新文件；服务器端路径穿越也会被拒绝。

## 架构规则

核心模块采用“class + singleton”导出方式：

```js
class ExampleManager { /* ... */ }
export const exampleManager = new ExampleManager();
export default ExampleManager;
```

跨模块变化优先使用 `js/core/EventBus.js`，避免不必要的循环依赖。新增核心全局状态时必须定义 owner、snapshot/restore（如需持久化）和事件语义。

### 核心模块职责

| 模块 | 责任 |
| --- | --- |
| `GameState` | day、clockMinutes、phase、duty、location、energy、mental、physical、satiety |
| `DayNightSystem` | 上班/下班/睡眠、工作日/休息日、最终阶段 |
| `TimeService` | 唯一普通游戏时间推进与阶段结算 owner；处理 20 分钟行动、物品/法术时间、睡眠日结 |
| `ScheduleData` | 加载 `workXXa/b` 和 `socialXXa/b`，按时间追加队列 |
| `ScheduleQueue` | 独立 `workQueue`、`socialQueue` 和非阻塞 `mainQueue` |
| `ItemManager` | 物品定义、背包、调查、使用条件/效果 |
| `ItemPlacementManager` | 场景物品摆放、可见条件、拾取/放回 |
| `GlobalVariableManager` | 全局变量定义、值、条件比较、效果、存档快照 |
| `SpellManager` | 学习/施放法术 |
| `KeywordManager` | 关键词定义、收集和笔记本来源 |
| `DialogueRunner` | HIS/Social 共用对话树执行 |
| `DialogueEffects` | 对话节点 onShow 的共享副作用 |
| `EndingManager` | 事件、对话、道具、属性和最终阶段结局 |
| `SaveManager` | v15 URL 存档、全局变量、法术、CG 和窗口布局恢复 |

## 状态机不变量

- 初始为第 1 天 `08:00`、`phase=day`、`duty=on-duty`、`location=work`。
- 工作窗口严格是 `[08:00, 16:00)`；天文白昼 `[06:00, 18:00)`，两者不可混用。
- 普通成功行动默认推进 20 分钟；不要使用真实系统时间、`Date`、`getHours()` 或计时器控制游戏时间。
- 所有玩家可见的计时操作（ChatGTP 查询、HIS 提交、物品调查/使用、法术学习/施放）必须先创建日程实例，再由 `ScheduleRunner` 或 `ItemScheduleRuntime` 执行；副作用和时间推进不得由 App 直接调用。
- 法术学习日程的顺序固定为“`consumeTime(240)` → `spellOperation` 调整已学习状态”。NPC 离线也必须通过 realtime 日程完成状态切换及后果。
- phase、duty、location 是独立字段；存档恢复时必须保持派生关系一致。
- 工作/夜班未完成的当前批次分别阻塞下班/睡觉；`entries: []` 是显式空批次，不是缺失数据。
- 午夜增加游戏日期；到次日 `08:00` 只结算一次睡眠、医疗、收入支出和睡眠债。
- 修改时间边界、行动费用或状态字段时，必须检查所有 App、快捷入口、存档恢复和事件订阅。

## 数据规则

- 通过 `dataLoader.loadJSON("file.json")` 加载，禁止硬编码 `data/zh-hans/`。
- UI 外壳字符串走 `i18n.t()` 并维护 `data/strings.<lang>.json`；剧情和内容直接放语言数据目录。
- 关键词内容只能来自 `keywords.json`；对话关键词通过 `[[keyword_id]]` 标记引用。
- NPC 使用稳定 `npcId`；不要把角色显示名当作持久化 ID。
- 全局变量文件顶层是数组；ID 唯一、非负整数；类型只能是 `bool`、`number`、`decimal`、`string`；number/decimal 范围 `0..256`，decimal 精确到小数点后 2 位。
- 全局变量 ID `0..99` 是系统预留，必须存在且不能通过开发人员模式删改；其中 `1` 为主角 SAN、`2` 为金钱、`5` 为 ChatGTP SAN、`20..39` 为主角技能点、`40..59` 为 NPC 好感度、`60..79` 为 NPC SAN。
- 条件支持 `condition`/`globalVariableCondition`、`globalVariables`、`all`、`any` 和 `eq/neq/gt/gte/lt/lte`。
- 全局变量效果使用 `value`，number/decimal 才能使用 `delta`。
- 书籍法术放在物品的 `spells` 数组；学习 240 分钟，施放默认消耗 5 SAN。代码存在不代表当前数据已有法术。

完整字段示例见 `docs/DATA-SCHEMAS.md`，状态与事件流见 `docs/ARCHITECTURE.md`。

## 开发人员模式边界

所有仅开发版代码必须使用明确标记：

```text
// DEV-TOOLS:START
// DEV-TOOLS:END
```

CSS/HTML 使用相应注释形式。开发入口必须严格判断 `?dev`，不能把普通查询串当开发模式。新增开发数据编辑器应校验 schema；「保存到内存」「下载」「写入磁盘」语义必须区分清楚。

## 存档规则

当前 `SaveManager` 格式为 v15，保存游戏状态、TimeService、工作/社交/主要三个队列、医疗、关键词、背包、NPC 状态、好感度、场景物品、对话进度、结局、全局变量、法术、动态日程、CG 和窗口布局。改变 payload 或编码布局时要评估是否提升版本；旧版本不应静默迁移。新增可恢复窗口时，将 appId 追加到 `WINDOW_APP_IDS`，并在 `main.js` 注册 launcher。

## 修改、验证和发布

1. 读取 `AGENTS.md`、相关模块、数据 schema、事件订阅和所有调用点。
2. 使用 `patch`/`write_file` 修改，不做无关重构；绝不读取、打印或提交凭据，若发现凭据必须替换为 `[REDACTED]`。
3. 修改 JS 后执行 `node --check`；修改 JSON 后执行 Python JSON 校验；始终执行 `git diff --check`。
4. 复杂状态改动要写确定性探针，覆盖初始值、边界、失败路径、恢复和副作用。
5. 发布玩家版执行 `node publish.js`，检查 `publish/` 不含 `DEV-TOOLS`、`DeveloperMode` 或 `dev-server.js`，并执行 `node --check publish/js/main.js`。
6. 不要主动打开浏览器做 UI 验证，除非用户明确要求或提供必须复现的步骤；静态检查和脚本探针结果要如实报告。
7. 不要提交、push、改写历史或创建 PR，除非用户明确要求；若用户要求交付，按改动规模选择直接 Conventional Commit 或独立分支 + PR。

项目没有测试框架、linter 或 bundler，不要凭空添加依赖。更多命令和协作细节见 `docs/DEVELOPMENT.md`。