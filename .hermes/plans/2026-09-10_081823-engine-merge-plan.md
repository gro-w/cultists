# 旧引擎与 NG 引擎融合执行计划

> **For Hermes:** 按阶段执行本计划；每个阶段完成后先通过验收门，再进入下一阶段。不得以“文件已复制”“JSON 可解析”代替运行时行为、存档恢复或 UI 交互验证。
>
> **状态：** 规划稿，不执行代码迁移
>
> **目标：** 将旧引擎的全部可玩内容和旧版外观迁移到采用 NG 三层架构的统一引擎，使最终产品由 `core` 原生 JavaScript、`framework` NGL 蓝图/数据、`game` NGL 蓝图/自定义窗口/数据库/公共变量组成。
>
> **工作目录：** `W:/_/cultists`
>
> **现有入口：** 旧引擎 `index.html`、`js/`、`css/`、`data/`；NG 引擎 `ng/`

---

## 1. 已确认的目标架构

### 1.1 三层职责

依赖方向只能是 `game → framework → core`，禁止反向依赖。

| 层 | 实现形式 | 允许职责 | 明确禁止 |
| --- | --- | --- | --- |
| `core` | 原生 JavaScript、通用 HTML/CSS 运行时 | 仿 Win95 桌面、窗口生命周期与渲染、NGL Activity 执行/调度/校验、节点/端口/连线、通用数据库与数据结构、公共变量/局部变量、事件总线、存档、通用能力网关、开发人员模式 | 患者、物品、NPC、日历、宿舍、剧情、结局、HIS 规则、具体成就语义 |
| `framework` | **只用 NGL 蓝图和数据** | 类似 stdlib 的可复用系统：时间、输入输出、资源、集合/数据库操作、条件、物品/角色/关键词/成就等通用预制系统、窗口交互组合 | 任何 `*.js` 业务模块；Cultists 专属 ID、剧情分支和领域快捷入口 |
| `game` | **只用 NGL 蓝图、自定义窗口语言和数据库数据** | 旧版所有剧情、患者、NPC、物品、法术、日历、宿舍、位置、下班流程、社交、HIS、特殊事件、结局、成就和 UI 文案 | 新增原生 JavaScript 业务逻辑；把业务语义塞进 `core`；通过 JS 绕过 Activity/窗口/变量系统 |

`ng/probes/`、`scripts/`、`tools/` 和 `dev-server.js` 属于迁移/开发工具，不属于发布运行时，不能被生产入口导入。

### 1.2 许可边界

- `core` 与 `framework` 代码、通用 schema、通用编辑器和通用运行时采用 BSD 2-Clause。
- `game` 层保留现有游戏内容版权，不因放入同一仓库、同一发布包或使用 NGL 而自动变为 2BSD。
- 许可证必须按文件/目录边界明确：引擎 LICENSE、游戏内容 NOTICE/版权声明、字体和图片等第三方资产的单独来源与许可。
- 发布脚本必须分别扫描和打包引擎与游戏内容，不能用 `ng/LICENSE` 覆盖 `ng/data/` 中的剧情、角色、图片、音频和其他内容。

### 1.3 终态产品原则

1. 玩家看到的桌面、窗口、按钮、任务栏和旧版流程由 NG 通用桌面 + Game 自定义窗口数据构成。
2. 旧版“下班模式”不再由 `GameMode`/`DayNightSystem` 等 JS 页面类直接绘制，而是由 Game 的下班自定义窗口、窗口事件蓝图和状态变量驱动。
3. 旧版“去往位置”不再由 `LocationSystem`/`LocationScene` JS 直接切换场景，而是由位置数据库、位置窗口、位置图标和蓝图 Activity 完成。
4. 物品、法术、患者、NPC、技能、关键词、成就、结局等全部进入 canonical 数据库/数据结构；Activity 只通过稳定 ID、变量和通用节点访问它们。
5. 所有玩家可见的计时和状态改变都必须先创建 Activity，再由通用执行器完成；窗口只能发命令或入队，不能直接修改游戏状态。
6. 引擎 ready 时只自动加入配置的 `default` Activity；后续业务调度只能由已运行的管理器 Activity 通过 NGL Activity API 显式完成。

---

## 2. 当前基线与迁移前冻结

截至本计划生成时，仓库已有：

- `ng/core/` 和 `ng/dev/` 的 NG JavaScript 运行时/编辑器；现有 `ng` JavaScript 文件约 66 个。
- 旧引擎 `js/` 约 90 个 JavaScript 文件，包含 `GameState`、`DayNightSystem`、`LocationSystem`、`ItemManager`、`MedicalCaseManager`、各类 App/View 和开发编辑器。
- `ng/data/` 约 198 个 JSON 文件，已有 `framework-manifest.json`、`game-manifest.json`、`databases.framework.json`、窗口定义、Activity、变量、种子记录和分组 Activity 列表。
- NG 已规定初始状态：第 1 天 `08:00`、`phase=day`、`duty=on-duty`、`location=work`；工作窗口 `[08:00,16:00)`。
- NG 当前 manifest 已包含 `off-duty.json`、`locations.json` 等窗口及 `work/social/managers/main/window-events/widget-events` 队列，但这些注册项在计划执行期间必须逐一追踪到真实 owner、执行器、UI 和存档闭环，不能仅按静态配置视为完成。

### 迁移前必须完成的冻结步骤

1. 重新运行 `git status --short --branch`，记录分支、干净状态和基线 SHA。
2. 复制旧 `data/`、`js/`、`css/`、`index.html` 到只读保存目录或迁移工作树；第一轮转换不得覆盖源文件。
3. 生成机器可读清单：文件路径、稳定 ID、数据库类型、Activity ID、节点/端口类型、窗口 ID、桌面图标 ID、事件、存档字段、资源引用和来源文件。
4. 分开建立三张清单：旧引擎源清单、NG 当前目标清单、生产运行时引用清单。不能用文件名相同推断内容等价。
5. 记录旧引擎基准行为：第 1 天 08:00、工作/下班/睡觉边界、普通行动 20 分钟、法术学习 240 分钟、工作与夜班阻塞、午夜结算、位置切换、物品使用、HIS 提交和代表性剧情分支。
6. 以后所有转换器必须从保存副本读取，明确支持幂等；若再次转换导致数量变化，立即停止并修复转换器，不得继续覆盖 canonical 数据。

建议新增但仅供迁移使用的产物：

- `tools/migration/legacy-inventory.mjs`
- `tools/migration/legacy-to-ng.mjs`
- `tools/migration/parity-matrix.json`
- `tools/migration/reports/`
- `scripts/probe-engine-merge.mjs`

这些工具不进入生产 manifest。

---

## 3. 分阶段执行步骤

## 阶段 0：建立边界、清单和验收基线

### Agent 0A：架构边界审计

**任务：**

1. 读取 `AGENTS.md`、`agent-notes.md`、`docs/ARCHITECTURE.md`、`docs/DATA-SCHEMAS.md`。
2. 枚举旧引擎所有入口、管理器、App/View、事件订阅、Activity 执行路径、存档 owner 和开发编辑器。
3. 枚举 `ng/core`、`ng/dev`、`ng/data`、`ng/probes`、`ng/scripts`、`ng/tools` 的生产/非生产边界。
4. 审查 `ng/core/engine.js`、`ng/core/engine-bootstrap.js`、`ng/data/framework-manifest.json`、`ng/data/game-manifest.json` 的加载顺序。
5. 输出 `parity-matrix.json`，每行至少包含：旧域、稳定 ID、旧文件、目标数据库/结构、目标 Activity、目标窗口/图标、Framework 能力、runtime owner、队列、存档字段、探针、状态。

**验收：** 清单有数量、有 stable ID、有空文件和无专用编辑器文件；所有未识别节点/效果均列为 gap，禁止静默丢弃。

### Agent 0B：协议与发布边界

**任务：**

1. 审查 `ng/LICENSE`、根目录 `LICENSE`、发布脚本和所有版权声明。
2. 明确 `core/framework` 2BSD 与 `game` 保留版权的文件分类规则。
3. 设计发布扫描：发布结果不得含开发工具、`DEV-TOOLS`、`DeveloperMode`、`dev-server.js` 或退休旧路径；同时必须保留游戏版权声明。
4. 检查字体、图片、音频和其他资产的授权来源，不得在融合时新增未确认授权的字体或素材。

**验收：** 有可自动失败的许可边界检查，而不是 README 中的口头约定。

---

## 阶段 1：冻结并稳定 Core 宿主

目标是先让 Core 成为不含游戏语义的、可独立验证的平台，不在此阶段迁移剧情。

### Agent 1A：Core 能力契约

按 owner 明确以下能力的输入、输出、权限/副作用、snapshot/restore 和确定性探针：

- DataLoader/DataStore/RuntimeRecordStore
- DataStructureManager
- PublicVariableManager/VariableStore
- ActivityDefinitionStore、ActivityNodeRegistry、ActivityValidator
- ActivityInstance、ActivityExecutionService、ActivityRunner、ActivityQueueRegistry
- WindowDefinitionStore、WindowManager、WidgetLayoutRenderer
- EventBus、EventActivityRouter、DisplayReceiverRegistry
- SaveManager、RuntimeRefResolver
- 桌面、图标、任务栏和通用窗口生命周期

新增能力只能是领域无关的能力网关。例如“数据库按稳定 ID 查询/写入”“窗口事件入队”“媒体资源按 ID 分发”可以进入 Core；“患者诊断”“物品治疗”“下班结算”不能进入 Core。

### Agent 1B：NGL 语言契约

固定并写入 schema/验证器：

- 流程输入节点不得同时有数值输出；有数值输出的节点不能有流程输入；流程起始/数值接收节点遵循项目规定的四类组合。
- Flow edge、value edge、局部变量、公共变量和稳定 ID 的格式统一。
- 节点执行失败必须产生诊断，不得变成隐式 no-op。
- 随机分支必须注入确定性 RNG；边界值、失败路径和重复调用可复现。
- 通用节点通过数据/能力网关访问上层，Core 不导入 Framework/Game 数据。

### Agent 1C：Core 与开发模式隔离

- 生产入口只能在严格 `?dev` 下挂载开发人员模式。
- `ng/dev/` 不得被普通运行时模块静态导入。
- 数据库编辑器必须区分“保存到内存”“下载”“写入磁盘”；写盘只能通过本地开发 API，并校验 schema、限制路径和清理 DataLoader 缓存。
- 存档调试器只能修改运行时/存档状态，不能把数据库 canonical 内容写入存档。

**阶段门 G1：** Core 独立启动；加载空 Game 包仍能创建桌面、窗口、Activity、变量、数据库和存档；静态边界审计通过；Core 无 Cultists 专属 ID/关键词/患者/剧情分支。

---

## 阶段 2：把 Framework 完成到“stdlib”级别

Framework 是全部 NGL/数据，不得添加 JavaScript manager。现有 `data/**/*.framework.json` 仅代表分类，不代表行为已经闭环。

### Agent 2A：通用数据结构和数据库系统

1. 定义结构：record、collection、map、set、enum、reference、optional value、localized text/resource reference。
2. 定义 database schema、primary key、索引、查询、插入、更新、删除、事务/失败语义。
3. 支持数据文件 seed 与运行时状态分离：canonical 数据库编辑器写盘；运行时变更进入 SaveManager 的状态快照。
4. 对物品、患者、NPC、关键词、成就等只提供结构和通用操作，不在 Framework 写入 Cultists 语义。
5. 增加重复 ID、引用不存在、错误类型、越权删除和版本不匹配探针。

### Agent 2B：通用变量、条件、时间和 Activity API

1. 固定公共变量类型、范围和 delta/value 规则；系统预留 ID 不可被开发模式删除或改类型。
2. 提供 `condition/globalVariableCondition/all/any/eq/neq/gt/gte/lt/lte` 的 NGL 求值。
3. 提供 `consumeTime`、队列入队、Activity checkpoint、成功/失败/取消、重入与幂等。
4. 提供通用 phase/duty/location 字段操作和边界网关，但不写工作/宿舍专用规则；具体规则进入 Game 数据和蓝图。
5. 保证时间不使用系统 `Date`、`getHours()` 或真实计时器控制游戏逻辑。

### Agent 2C：通用窗口/Widget 组合

提供可声明式组合原语：

- composition、repeat、conditional visibility、property binding
- text/image/list/table/form/dialogue/choice
- `onCreate`、`onDestroy`、`onClick`、`onChange`、`onFocus`、`onBlur` 的 Activity 绑定
- 窗口打开、关闭、焦点、拖拽、最小化、最大化、布局读取/写入
- display receiver 的注册、分发和关闭清理

Framework 不为 HIS、下班、宿舍或某一角色创建专用 renderer。若某能力无法由现有声明式原语表达，先扩展通用 Widget/DOM 契约，再由 Game 数据组合。

**阶段门 G2：** 以一个空内容包和一个最小示例包验证数据库、变量、时间、Activity、窗口和存档；Framework 目录无生产 JS；所有节点/窗口事件均经过通用执行系统。

---

## 阶段 3：把旧引擎内容转换为 Game canonical 数据

### Agent 3A：数据与 ID 迁移

按“先 schema、后数据、再 owner”迁移，不得把旧管理器代码直接复制到 `game`：

| 旧内容 | Game canonical 目标 |
| --- | --- |
| `ItemManager`、物品 JSON、道具效果 | `items` database、`item` structure、item Activity/效果蓝图 |
| `SpellManager`、学习/施放 | spell records、spell Activity、公共变量/状态集合 |
| `GlobalVariableManager` | Framework 变量系统 + Game 变量定义/初值 |
| `KeywordManager` | keyword database、收集 Activity、notebook 窗口绑定 |
| `MedicalCaseManager`、患者/病例 | patients、symptoms、diagnoses、medicines、cases 等数据库，HIS/医疗 Activity |
| NPC/favor/SAN/skills | npc、relationship、skill 记录及变量；只通过稳定 ID 访问 |
| `CalendarData`、Schedule | calendar/schedule 数据、Activity lists、manager Activity |
| `AchievementManager` | achievement database、条件/触发蓝图、成就窗口 |
| `EndingManager`、CG/BGM/media | endings/media 数据、ending Activity、媒体 display receiver |
| 旧对话树/剧情 JSON | canonical dialogue/Activity 数据，未支持节点必须报 gap |
| 旧 App 数据 | window definition、desktop icon、数据库/变量绑定和事件 Activity |

每个转换器必须：

- 保留 stable ID 和 authored 字段；不以显示名作持久化 ID。
- 保留未知兄弟字段并报告无法转换字段。
- 输出 sourceFile、targetFile、转换状态和 diagnostics。
- 做 source count = manifest count = target count、JSON 可解析、引用存在、重复 ID 检查。
- 对同文本但不同语义/来源/分支/版本/病种变体的实体不得擅自合并。

### Agent 3B：物品垂直切片

先完成一个物品的完整闭环，再批量转换：

`item record → item database → 使用条件 → use-item Activity → consumeTime → 通用库存操作 → item effect event/gateway → 变量/状态 owner → 窗口刷新 → SaveManager snapshot/restore`。

书籍法术按旧规则进入物品 `spells` 数组；学习必须 `consumeTime(240)` 后再执行学习效果；施放默认消耗 5 SAN。背包变化、失败路径、重复使用、数量归零和读档后继续使用必须有探针。

### Agent 3C：医疗/HIS 垂直切片

按患者选择、症状筛选、诊断、处方、提交、结算分别建立 Activity 和数据库绑定。HIS 窗口只渲染数据并触发 Activity，不直接导入医疗 JS。成功、错误诊断、无药、重复提交、时间消耗和存档恢复必须覆盖。

### Agent 3D：剧情/对话垂直切片

把旧 DialogueRunner/DialogueEffects 的行为映射到 NGL：

- 节点、选项、条件、关键词、变量效果和时间成本均为数据/蓝图。
- 对话显示通过 `displayTo` + DisplayReceiverRegistry + 通用 dialogue Widget。
- 不把 `DialogueEffects` 迁移为 Game JS；专用副作用通过通用变量、数据库操作或显式能力网关完成。
- 每个可达分支必须以通用 end 节点结束；unsupported node 不能静默跳过。

**阶段门 G3：** 数据全量核对完成；每个核心域至少有一个真实 Activity→owner→window/state→save round-trip 探针；所有未迁移域在 parity matrix 标为 partial/missing/unverified。

---

## 阶段 4：以 NG 自定义窗口复刻旧版外观和交互

目标是“外观类似旧版”，不是保留旧 App/View 类。

### Agent 4A：桌面与通用窗口

1. 以旧版实际 DOM/CSS、窗口尺寸、标题、图标、层级和关闭行为为基准建立对照表。
2. 用 NG `WindowDefinition` 和 Widget 树重建桌面、任务栏、开始菜单、状态、笔记本、成就、日历、HIS、聊天等窗口。
3. 每个窗口拥有稳定 `windowId`；实例拥有 `windowInstanceId`；多窗口编辑器和运行时实例隔离 DOM 查询、事件上下文和选中状态。
4. 动态字段必须绑定 canonical 数据或变量；静态标签/无消费者按钮不得标记为完成。
5. 所有窗口打开和组件事件必须经过 shared open-window blueprint 或 widget Activity。

### Agent 4B：下班模式窗口

替换旧 `GameMode`/下班界面为 Game 自定义窗口：

- `off-duty` window 负责渲染旧版下班选择、当前未完成工作提示和可用动作。
- “强制下班”“正常下班”“取消/返回”等动作绑定 NGL Activity。
- 未完成患者/工作批次的阻塞规则由 Game 数据与蓝图表达，不能在窗口 JS 中判断。
- 强制下班触发旧版业务成就时，通过成就 Activity/事件进入 canonical achievement state，并可随存档进入发布版；它不是开发人员模式内容。
- 验证从工作窗口打开下班窗口、边界时间、未完成批次、强制下班、关闭窗口、刷新和读档。

### Agent 4C：位置窗口

替换旧 `LocationSystem`/`LocationScene`：

- `locations` database 保存稳定位置 ID、名称、资源、可见条件和可前往条件。
- `locations.json` 是声明式窗口；每个按钮绑定 `go-to-location` Activity。
- Activity 负责条件检查、位置变量写入、资源/场景显示和事件通知。
- 从位置窗口、桌面图标、宿舍/社交场景进入位置必须走同一个通用入口，禁止多个 JS 快捷路径。
- 位置切换不自动推进时间，除非 Game Activity 明确包含 `consumeTime`。

### Agent 4D：资产与文字

- UI 外壳字符串使用 `i18n.t()`；剧情文本进入语言/内容数据。
- 资源用稳定 ID 和 manifest 引用；不硬编码语言目录或显示名称。
- 验证旧版窗口的真实布局和交互需要启动 NG 开发服务器并浏览器点击；静态窗口解析只能证明注册，不证明 UI parity。

**阶段门 G4：** 旧版核心玩家路径可从 NG 桌面完成：打开窗口 → 选择位置/下班 → 创建 Activity → 状态改变 → 窗口刷新 → 保存 → 新会话恢复；报告静态注册和浏览器交互结果分开。

---

## 阶段 5：迁移调度、日历和全部剧情

### Agent 5A：启动和管理器 Activity

1. `engine-bootstrap` 只加载 Core + Framework manifest + Game manifest。
2. ready 时只入队 `default` Activity。
3. default Activity 显式启动时间、输入输出、资源、物品、关键词、成就、医疗、日历等 manager Activity；engine.js 不依据领域语义自行插入 Activity。
4. manager Activity 的状态变更必须由蓝图执行并能被保存/恢复；只发 `manager-ready` 或 append history 的 scaffold 不能视为完成。
5. 每个事件路由都做 closure audit：emitter、declared route、生产 consumer、authoritative mutation、visible receiver、SaveManager owner。

### Agent 5B：日程和队列

- 将旧 `work/social/main` 队列行为迁移为 Game 日程数据 + 管理器 Activity。
- 保持工作/夜班未完成批次分别阻塞下班/睡觉；`entries: []` 是显式空批次。
- 保持午夜日期增加、次日 08:00 只结算一次睡眠/医疗/收入支出/睡眠债。
- 逐日核对第 1–7 天剧情；日历可显示第 8–31 天灰色未解锁占位，但不得让这些日期进入可玩调度。

### Agent 5C：剧情全量核对

对旧 `data/` 的每个剧情集合逐条核对：

- exact stable ID 是否存在
- authored entry 数量是否一致
- 是否被拆成多个 canonical Activity
- 是否存在有意重命名/拆分
- 是否存在真正遗漏
- 触发条件、可见条件、选项、变量效果、时间成本、媒体和结局是否一致

输出“保留数据”“行为已迁移”“partial”“missing”“unverified”五类状态，不能以 Activity 文件数量相等代替语义核对。

**阶段门 G5：** 所有计划内游戏域均有明确状态；必要剧情路径可在真实 NG 入口执行；没有旧引擎运行时路径参与生产调度。

---

## 阶段 6：替换入口、退休旧运行时和发布

### Agent 6A：生产入口切换

1. 让根 `index.html` 只加载融合后的 NG Core 入口。
2. 将旧 `js/`、旧 App/View、旧直接副作用入口从生产加载图移除；不要先删除，先通过引用审计确认无生产引用。
3. 更新开发服务器、相对路径、探针、发布脚本和 README。
4. 旧格式编辑器只有在 canonical NG 数据编辑器、schema 校验、内存/下载/写盘语义和迁移结果都验证后才能退休。
5. 删除或归档旧兼容目录前，记录精确删除路径和验证结果；不报告本来就不存在的文件为本次删除。

### Agent 6B：发布与许可验证

执行：

- `node publish.js`
- `node --check publish/ng/core/engine.js` 或实际生成入口
- 发布目录全量扫描 `DEV-TOOLS`、`DeveloperMode`、`dev-server.js`、旧路径和开发探针
- 扫描发布内容中的 2BSD 声明、Game 版权声明、字体/素材来源声明
- 验证发布版只保留运行时所需 Core、Framework/Game 数据和资源

### 阶段门 G6：最终融合完成

只有同时满足下列条件才允许标记完成：

- Core/Framework/Game 层边界审计通过。
- Game 层生产路径无原生 JavaScript 业务模块。
- 旧剧情和内容清单无未解释遗漏。
- 下班和位置已由自定义窗口 + Activity + 变量/数据库实现。
- 物品等领域数据已进入 canonical database/structure，而不是 JS manager 私有 Map。
- Activity、窗口事件、事件路由、状态 owner 和存档恢复均已闭环。
- 初始状态、时间边界、失败路径、重复调用、恢复和副作用均有确定性探针。
- 真实 NG 入口完成浏览器验证；静态检查、脚本探针、浏览器交互分别报告。
- 发布产物不含开发工具/旧入口/退休运行时路径，许可边界清晰。
- `git diff --check` 通过；工作树和远端状态按项目交付规则单独报告。

---

## 4. 推荐的 Agent 拆分与依赖顺序

不得让多个 Agent 同时修改同一核心契约文件。推荐顺序：

1. `inventory-agent`：阶段 0，生成清单和 parity matrix。
2. `boundary-agent`：阶段 0/1，Core/Framework/Game 审计。
3. `core-contract-agent`：阶段 1，Core/NGL 契约和探针。
4. `framework-data-agent`：阶段 2，数据库、变量、条件、时间和通用节点。
5. `framework-widget-agent`：阶段 2，声明式窗口/Widget 原语。
6. `item-slice-agent`：阶段 3，物品/法术/库存垂直切片。
7. `medical-slice-agent`：阶段 3，HIS/医疗垂直切片。
8. `story-slice-agent`：阶段 3，剧情/对话/媒体/结局。
9. `window-parity-agent`：阶段 4，旧版外观和窗口行为。
10. `off-duty-location-agent`：阶段 4，下班和位置窗口。
11. `schedule-agent`：阶段 5，日历/队列/管理器 Activity。
12. `parity-audit-agent`：阶段 5，逐条内容与行为核对。
13. `retirement-release-agent`：阶段 6，入口替换、旧运行时退休、发布扫描。
14. `independent-review-agent`：不修改目标代码，独立检查存档时序、双重副作用、发布边界和旧行为等价性；发现问题必须回到对应阶段修复并重新跑全套验证。

每个 Agent 的交付必须包含：改动文件、稳定 ID/数量变化、运行命令、实际输出、未完成项、是否需要浏览器验证；不得只提交“已迁移”文字。

---

## 5. 统一验证命令与验收矩阵

### 5.1 每次改动后

```bash
node tools/audit-ng-layer-boundary.mjs --strict
python3 - <<'PY'
import json
from pathlib import Path
for path in Path('ng/data').rglob('*.json'):
    json.loads(path.read_text(encoding='utf-8'))
print('JSON_OK')
PY
node --check <所有变更的 .js/.mjs 文件>
git diff --check
```

### 5.2 每个迁移切片

必须至少验证：

1. canonical 数据加载与 schema 校验
2. Activity validator 零诊断
3. 成功路径
4. 条件失败路径
5. 重复调用/幂等
6. 时间成本和边界
7. visible window/display receiver 更新
8. 保存、改变 live state、恢复旧状态的 round-trip
9. 事件消费者闭环和唯一 authoritative owner
10. 稳定 ID、manifest、列表、日历和数据库引用一致

### 5.3 最终探针集合

现有 `ng/probes/` 与根 `scripts/` 探针必须全部运行，不能只运行新增探针。至少覆盖：

- Activity/节点/端口/随机分支
- 初始状态、下班、睡眠、工作边界、位置边界
- 物品库存、法术学习/施放、关键词
- 医疗/HIS 提交与结算
- 对话、社交、宿舍
- 成就、媒体、结局
- 窗口/图标/显示接收器
- 公共变量类型和范围
- 保存/恢复和发布产物

报告必须分别列出：

| 验证类别 | 可宣称内容 | 不可代替的内容 |
| --- | --- | --- |
| JSON/静态审计 | 结构、引用、层边界 | 行为和 UI 交互 |
| 确定性探针 | owner、状态、副作用、存档契约 | 浏览器布局与点击感受 |
| HTTP/入口检查 | 页面能加载、模块路径正确 | 所有玩家路径可操作 |
| 浏览器验证 | 实际窗口、按钮、流程交互 | 未点击的路径不能宣称通过 |
| 发布扫描 | 开发代码/旧路径/许可边界 | 游戏内容本身无遗漏 |

---

## 6. 关键风险与处理规则

1. **把旧 JS manager 改名后放进 Game。** 这是架构违规；必须先抽象为 Core 通用能力或 Framework NGL 系统，再由 Game 数据调用。
2. **只复制 JSON。** 数据存在不代表 runtime owner、窗口、存档和副作用存在；必须完成垂直切片。
3. **事件只写 history。** 事件路由若没有真实状态 owner/显示 receiver/save snapshot，只能标为 partial。
4. **双重执行。** 迁移期间旧 listener 与新 Activity 同时监听会导致双倍耗时/副作用；切换后必须搜索并禁用旧执行器。
5. **存档时序错误。** 恢复必须先 reset owner，再应用 payload，并重新创建 Activity runner；新增字段需要版本策略和旧 fixture 更新。
6. **窗口看起来像旧版但按钮无消费者。** 每个状态改变按钮必须追到 Activity、owner、事件和保存字段。
7. **把开发工具带入发布。** 发布前必须扫描并失败退出；`?dev` 不是发布安全边界的唯一保障。
8. **错误合并同名数据。** stable ID、病种变体、剧情分支、来源和版本不同即使显示文本相同也不能合并。
9. **迁移器破坏源数据。** 源数据只读保存，转换器从副本运行，并检查重复转换的计数稳定性。
10. **把 Framework manager scaffold 当作完成。** 只有状态变化、持久化、失败路径和生产 bootstrap 注入都验证后才算完成。
11. **用静态探针冒充 UI parity。** 必须启动 NG 实际入口并完成点击；无法验证的路径明确标记 unverified。
12. **协议误覆盖游戏版权。** 发布和仓库 NOTICE 必须按目录/文件分类，不能只保留一份笼统 LICENSE。

---

## 7. 完成报告模板

最终 Agent 必须生成一份交付报告，至少包含：

- 基线 SHA、最终 SHA、分支和远端同步状态
- 旧源文件/记录/Activity/窗口/图标数量与 NG canonical 数量
- 每个域的 `migrated data / migrated runtime / partial / missing / unverified` 状态
- 精确删除和退休的旧路径
- Core/Framework/Game 边界审计结果
- 全套探针总数、通过数、失败数和失败原因
- 浏览器验证过的实际路径；未验证路径
- 发布产物扫描结果和许可声明位置
- 已知风险、剩余 TODO 和是否允许发布

在上述报告完成、独立审查问题全部修复并重新验证之前，不得称为“融合完成”。
