# AGENTS.md

本文件是所有 coding agent 的项目合同。只保留必须遵守的规则；项目背景、命令示例、模块索引和详细参考见 [`agent-notes.md`](agent-notes.md)。修改前先阅读相关代码、数据 schema 和调用点；不要凭文件名猜接口。

## 通用规则

- 所有文本文件使用 LF 换行。
- 使用原生 HTML/CSS/ES6 modules；不要引入构建步骤、框架或未经需要的依赖。
- 游戏内容通过数据文件加载；代码使用稳定 ID，不要硬编码语言目录或显示名称作为持久化 ID。
- UI 外壳字符串使用 `i18n.t()`；剧情和内容放在语言数据目录。
- 只使用许可证明确允许商业使用的开源、免费字体。新增字体必须确认授权，并在项目中保留可审计的来源；字体选择必须覆盖正文、标题、控件、伪元素、开发工具和发布版本。
- 只有通用章节和 NG 三层架构与 NGL 语言边界 章节及约束NG引擎，只有通用章节和旧引擎章节约束旧引擎（位于project root）

## NG 三层架构与 NGL 语言边界

- 蓝图编程语言正式命名为 **NGL（NG Language，NG 蓝图语言）**。Activity 蓝图、节点、端口、流程边、数值边、局部变量和公共变量访问均属于 NGL 的语言契约；编辑器、校验器、运行器和调试器必须使用同一契约。
- NG 引擎严格分为 `core`、`framework`、`game` 三层。`core` 是唯一允许使用原生 JavaScript 实现的层；`framework` 和 `game` 层必须全部使用 NGL 蓝图及数据文件实现，不得使用原生 JavaScript 编写业务逻辑、业务 Activity、业务管理器、业务窗口行为或业务系统。
- `core` 只提供通用且与具体游戏无关的宿主能力：仿 Win95 桌面、Activity 实例执行引擎、Activity 执行池与调度、NGL 节点/端口/连线校验与求值、自定义窗口运行时和编辑器、通用数据结构、公共变量、局部变量、存档、事件总线、输入输出与受控能力网关、开发人员模式及发布剔除机制。`core` 不得包含患者、物品、日历、宿舍、成就、结局、NPC 或具体应用语义。
- `framework` 只能用 NGL 在 `core` 通用能力之上实现预制系统，例如时间、输入输出、资源、数值、物品、角色、窗口和通用 UI 行为。预制系统不得通过原生 JavaScript 偷渡专用副作用；需要宿主能力时，必须先在 `core` 增加可复用、与领域无关的能力网关和类型安全 NGL 节点。
- `game` 只能用 NGL 和数据实现具体游戏内容、业务 Activity、管理器 Activity、患者、宿舍、日历、社交、物品、成就、结局、应用和剧情。`game` 不得新增原生 JavaScript 业务模块，也不得把业务语义反向写入 `core` 或以 JavaScript 绕过 Activity 执行系统。
- 如果 `framework` 或 `game` 需要原生 JavaScript 才能完成的能力，必须将其抽象为通用 core 能力，并通过公开的 NGL 节点、值端口、流程端口或能力网关调用；禁止在上层添加只服务单一业务的 JavaScript 快捷入口。新增 core 能力必须定义 owner、输入输出契约、权限/副作用、snapshot/restore（如需持久化）和确定性探针。
- `core/engine.js` 只能启动 core 并加载 NGL framework/game 内容包；内容 bootstrap、业务调度和业务初始化必须由 NGL Activity 完成。发布版必须剔除开发人员模式代码、编辑器和调试入口，同时保留 framework/game 的 NGL 数据和运行时所需的 core 通用能力。
- 三层依赖方向只能是 `game → framework → core`；禁止 `core → framework`、`core → game` 或 `framework → game`。数据、蓝图定义和能力注册必须通过稳定 ID 与明确 schema 连接，不得通过原生 JavaScript 直接跨层调用。
- 引擎 ready 时只允许把配置中的 default Activity 加入 default 队列；后续调度必须由已运行的管理器 Activity 通过蓝图 Activity API 显式完成。引擎不得依据日历、患者、社交或成就语义自行创建或插入 Activity。
- `core/engine.js` 只能作为平台入口加载内容包并启动平台；
- 开发人员模式入口不得进入发布数据或发布产物。业务成就不是开发人员模式内容，必须保留在业务数据和发布版中，并能通过存档进入发布版。


## 旧引擎架构与状态规则

- 核心模块遵循 class + singleton 导出约定；跨模块变化优先使用 `js/core/EventBus.js`，避免不必要的循环依赖。
- 新增核心全局状态必须定义 owner、snapshot/restore（如需持久化）和事件语义。
- 初始状态必须为第 1 天 `08:00`、`phase=day`、`duty=on-duty`、`location=work`。
- 工作窗口严格为 `[08:00, 16:00)`；不要将其与天文白昼 `[06:00, 18:00)` 混用。
- 普通成功行动默认推进 20 分钟；不得使用真实系统时间、`Date`、`getHours()` 或计时器控制游戏时间。
- 所有玩家可见的计时操作必须先创建活动实例，再由 `ActivityRunner` 或 `ItemActivityRuntime` 执行；App 不得直接调用副作用或时间推进。
- 法术学习活动必须按 `consumeTime(240)` → `spellOperation` 的顺序执行；NPC 离线也必须通过 realtime 活动完成状态切换及后果。
- `phase`、`duty`、`location` 是独立字段；存档恢复必须保持派生关系一致。
- 工作/夜班未完成的当前批次分别阻塞下班/睡觉；`entries: []` 是显式空批次，不是缺失数据。
- 午夜增加游戏日期；到次日 `08:00` 只结算一次睡眠、医疗、收入支出和睡眠债。
- 修改时间边界、行动费用或状态字段时，必须检查所有 App、快捷入口、存档恢复和事件订阅。
- 蓝图节点只允许四类端口组合：有流程输入引脚的节点是流程节点，禁止同时拥有数值输出引脚；有数值输出引脚且没有流程输入引脚的节点是数值节点；流程输入和数值输出都没有、但有流程输出的节点是流程起始节点；流程输入和数值输出都没有、但有数值输入的节点是数值接收节点。不得新增或保留其他组合。

## 旧引擎数据规则

- 通过 `dataLoader.loadJSON("file.json")` 加载数据，禁止硬编码 `data/zh-hans/`。
- 关键词只能来自 `keywords.json`；对话关键词使用 `[[keyword_id]]` 标记引用。
- 公共变量文件顶层必须是数组；ID 唯一且为非负整数；类型只能是 `bool`、`number`、`decimal`、`string`；number/decimal 范围为 `0..256`，decimal 精确到小数点后 2 位。
- 公共变量 ID `0..99` 为系统预留，必须存在且不得通过开发人员模式删改；其中 `1` 为主角 SAN、`2` 为金钱、`5` 为 ChatGTP SAN、`20..39` 为主角技能点、`40..59` 为 NPC 好感度、`60..79` 为 NPC SAN。
- 条件使用 `condition`/`globalVariableCondition`、`globalVariables`、`all`、`any` 和 `eq/neq/gt/gte/lt/lte`；公共变量效果使用 `value`，number/decimal 才能使用 `delta`。
- 书籍法术放在物品的 `spells` 数组；学习耗时 240 分钟，施放默认消耗 5 SAN。

## 通用开发人员模式与存档规则

- 仅开发版代码必须使用 `DEV-TOOLS:START` / `DEV-TOOLS:END` 标记；CSS/HTML 使用对应注释形式。
- 开发入口必须严格判断 `?dev`，不能把普通查询串当作开发模式。
- 新增开发数据编辑器必须校验 schema，并区分「保存到内存」「下载」「写入磁盘」语义。
- 修改存档 payload 或编码布局时必须评估是否提升版本；旧版本不得静默迁移。
- 新增可恢复窗口时，必须将 appId 加入 `WINDOW_APP_IDS`，并在 `main.js` 注册 launcher。

## 通用修改、验证和交付规则

1. 修改前读取 `AGENTS.md`、相关模块、数据 schema、事件订阅和所有调用点；详细项目参考见 `agent-notes.md`。
2. 使用 `patch`/`write_file` 修改，不做无关重构；绝不读取、打印或提交凭据，若发现凭据必须替换为 `[REDACTED]`。
3. 修改 JS 后执行 `node --check`；修改 JSON 后执行 Python JSON 校验；始终执行 `git diff --check`。
4. 复杂状态改动必须写确定性探针，覆盖初始值、边界、失败路径、恢复和副作用。
5. 发布玩家版执行 `node publish.js`，确认 `publish/` 不含 `DEV-TOOLS`、`DeveloperMode` 或 `dev-server.js`，并执行 `node --check publish/js/main.js`。
6. 除非用户明确要求或提供必须复现的步骤，不主动打开浏览器做 UI 验证；如实区分静态检查、脚本探针和浏览器验证结果。
7. 不要提交、push、改写历史或创建 PR，除非用户明确要求；用户要求交付时，按改动规模选择直接 Conventional Commit 或独立分支 + PR。