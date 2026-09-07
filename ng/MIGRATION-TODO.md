# NG 引擎迁移待办与重复数据审计

生成时间：2026-09-07

本报告基于当前工作树的实际扫描结果。`ng/` 当前不是旧版的行为等效替代品；JSON 能被加载、蓝图能通过转换器，不能单独证明运行时等效。

## 1. 盘点基线

| 项目 | 旧版 | NG | 结论 |
| --- | ---: | ---: | --- |
| JSON 文件 | 54 | 186 | NG 已拆分出活动、数据库、窗口、种子数据等新载体 |
| 蓝图 | 168 | 212 | NG 多出的蓝图包括成就、结局、事件、HIS 和逐病人活动 |
| 顶层稳定 ID | 1,052 | 48,818 | 两边 ID 口径不同，不能用总量判断迁移完成 |
| 转换器覆盖 | — | 168/168 | 仅表示旧版蓝图转换器可处理全部旧版蓝图，不代表 NG 执行语义完整 |
| 旧版 ID 尚未在 NG 找到 | — | 37 | 见下方“明确缺口” |

执行证据：

- `node ng/tools/audit-legacy-ng.mjs` 成功，输出上述语料统计。
- `node ng/tools/migrate-legacy-blueprint.mjs --report` 成功：`168/168 blueprints fully convertible today`。
- 当前未进行浏览器交互验证；以下“未验证”不得视为已等效。

本轮已完成的迁移实现（2026-09-07）：

- 新增 `ng/core/LegacyContentEventGateway.js`，将旧版转换产生的 `content:*` 事件接入 NG 的媒体、物品、法术、HIS 选择/提交服务；不再把这些事件当作无消费者的裸 `EventBus` 广播。
- `SpellManager` 新增学习状态校验的 `cast()` 入口；未学习法术返回明确失败结果，不产生施放事件。
- `ActivityScheduler` 保留一个只读、非 canonical 的旧文档调度适配器，供旧存档/调试探针读取；正式引擎仍只使用 `activity-calendar.json`。
- 新增 canonical `seed-records-items.json`，迁入旧版 29 个物品定义及其 investigate/use 蓝图；引擎启动时将定义加载进 `ItemManager`，并从物品定义生成 5 个稳定法术 ID（`<bookId>__<index>`）。
- `ItemManager` 已支持定义查询、usable/owned 校验、consumable 消耗和 item-used 事件；`SpellManager` 已支持法术定义、学习、cast SAN 成本和 SAN 不足失败路径。
- 新增 `ng/probes/item-spell-migration-probe.mjs`，验证 29 个物品、5 个法术、可用性、学习、10 SAN 消耗和不足失败。
- 新增 canonical `ng/core/MedicalCaseManager.js`，从 `patients`/`diagnoses`/`medicines`/`diagnosisCategories` 数据库加载 HIS 权威数据，完成诊断校验、最多 5 种药物、奖金/佣金、投诉/医闹类型、重复提交拒绝、收入结算和存档快照。
- `LegacyContentEventGateway.hisSubmit()` 在具备患者与诊断字段时路由到 `MedicalCaseManager`，无医疗字段的通用选择提交仍保留 `SelectionSubmissionManager` 路径；新增 `ng/probes/medical-case-migration-probe.mjs` 覆盖成功提交、210 pending income、事件和重复提交失败。
- 修正延迟加载 ChatGTP 数据的验证探针，并补充 `ng/probes/legacy-content-event-gateway-probe.mjs`，覆盖 CG、背包和 HIS 提交流程。
- 所有 36 个现有 NG 探针均通过；JSON 186 个文件全部可解析，字节级和规范化重复均为 0 组。
- 新增 `status`、`achievements`、`calendar`、`settings`、`locations` 五个 NG 自定义窗口，并在 `desktop-icons.json` 注册对应的 `desktop.open-window` 桌面图标；新增 `custom-app-migration-probe.mjs` 验证 manifest、窗口根布局和图标入口。
- 五个窗口的 NG widget-tree 外壳和稳定入口已迁移；动态状态刷新、成就解锁、日历随日期变化、设置持久化和位置状态变更仍需浏览器运行时验证，不能仅凭静态定义宣称完全等效。
- 本轮继续将五个窗口接入通用运行时变量与事件链：状态读取公共变量/游戏状态镜像，成就列表读取 `AchievementSystem` 并监听解锁事件，日历读取 `calendar-rules.json` 并监听游戏时钟，设置通过 `VariableStore` 写入可存档变量，位置按钮通过 `location:requested` 进入 `PhaseBoundaryService.requestLocation()`。
- 本轮新增/修改后的静态验证：38 个探针通过，191 个 NG JSON 全部可解析；浏览器点击、完整旧版对照和存档恢复仍未验证。
- 修正 NG 初始时钟：从引擎 `initialState.clockMinutes` 初始化，默认与旧版一致为第 1 天 08:00；状态镜像补齐 mental/phase/duty/location，并将主角 SAN 同步到公共变量 1。
- 设置窗口补齐旧版 BGM 音量、笔记本排序和下班/睡觉确认设置；默认值只在变量不存在时写入，避免启动时覆盖已恢复的设置。
- SaveManager 升级至 v5，将权威 `GameState` 纳入存档快照、校验、恢复和回滚流程；旧 v4 存档按约定拒绝静默迁移。新增/修正存档探针后 38 个探针全部通过。
- 五类 NG 窗口按旧版窗口尺寸对齐：状态 400×440、成就 440×480、日历 460×500、设置 360×300；设置恢复为不可调整大小。
- 新增旧版 Win95 应用表面的通用样式类：状态行、成就卡片及解锁/未解锁状态、日历七列网格、锁定提示、设置滑块/复选框和地点按钮；窗口定义通过 `className` 使用这些样式。
- WidgetLayoutRenderer 新增通用 `range` 控件，并允许列表项声明动态 `className`，用于 BGM 滑块和成就解锁样式，不增加窗口专用渲染器。
- 当前浏览器截图验证确认旧版桌面上的成就和日历窗口结构、窗口尺寸及 Win95 外观；NG 专用入口仍需在 NG URL 下逐项点击验证，不能将旧版入口截图当作 NG 完全视觉等效证明。

## 2. 迁移待办总表

状态定义：

- **缺失**：扫描已证明 NG 没有对应数据或运行时入口。
- **部分**：有数据/节点/入口，但仍缺少一段行为链、语义或持久化。
- **未验证**：静态结构存在，尚未用确定性运行时探针或浏览器操作证明。
- **数据已迁移**：只说明数据载体存在，不等于行为已迁移。

### P0：必须先补齐，否则不能称为旧版等效

- [x] **结局 CG/图片事件网关**（事件网关已完成；展示 UI 仍待验证）
  - 旧版有 `showCg` 33 次、`endCg` 1 次、`showImage` 14 次。
  - NG 转换器把它们改写为 `emitEvent`，例如 `content:showCg`。
  - `LegacyContentEventGateway` 已将 `showCg`、`showImage`、`endCg` 分别接入 `MediaStateManager`，并发出 `media:cg`、`media:play`、`media:end-cg`。
  - 已有确定性探针覆盖解锁、结束事件和重复运行所需的状态入口；仍需浏览器层 CG/图片展示组件和真实回放/存档操作验证。

- [ ] **物品/法术迁移运行时**（事件入口已完成；完整语义仍部分）
  - 旧版节点：`inventoryOperation` 6 次、`spellCast` 3 次、`spellEffect` 2 次。
  - `LegacyContentEventGateway` 已消费物品增减、法术施放/效果事件；`SpellManager.cast()` 已拒绝未学习法术并发出 canonical `spell:cast`。
  - 已补齐定义载入、usable/owned/consumable 基础语义、稳定法术 ID、学习状态和施放 SAN 扣除/不足失败；仍需将 item-owned blueprint 接入 `ActivityExecutionService`，补齐 investigate/use/take/put-back 的时间推进、物品条件与效果、法术学习 240 分钟、离线 NPC 后果和存档恢复。

- [ ] **HIS 医疗系统端到端运行**（权威结算核心已接入；UI/完整时序仍未验证）
  - NG 有 `his__*` 活动、数据库和 HIS 窗口定义，但旧版 `hisRefresh`、`hisSelectPatient`、`hisRenderDiagnosis`、`hisRenderPrescription`、`hisSubmit` 已被转换成事件。
  - 每个 `content:his*` 事件现在均有 `LegacyContentEventGateway` 消费者；带患者/诊断字段的提交进入 `MedicalCaseManager`，通用选择提交进入 `SelectionSubmissionManager`。
  - 已接入 `medicalCase`/`patient` 的权威诊断、处方、结算和错误反馈核心；仍需将 HIS 窗口控件与该 manager 的患者列表、分类筛选、提交结果和收入变化逐项接通，并验证完整时序。
  - 覆盖病人切换重置、分类筛选、错误诊断/药物、正确结算、奖励/罚款、重复提交、离开窗口和保存恢复。

- [ ] **特殊事件与结局的触发闭环**（部分）
  - NG 有 `event__*`、`ending__*` 活动和 `specialEvents`/`endings` 数据，但尚未证明触发器、条件、事件队列、结局解锁和回放的一致链路。
  - 特别检查 `ending` 节点不能在结局回放中递归触发自身；事件触发蓝图与结局回放蓝图应分离。
  - 覆盖睡眠触发、法术触发、属性/公共变量阈值、分支收敛、结局解锁和恢复。

- [ ] **工作/医疗日程完整迁移**（部分）
  - 旧版 `work01a`–`work07b`、`workpub` 中的内容已部分拆成逐病人活动。
  - `medical_complaint_work` 与 `medical_riot_work` 仍存在于 NG 文件和活动清单，但没有被当前活动日历/活动分类引用；它们在旧版 `workpub.json` 中有真实来源，不能直接删除，必须决定是接入日历还是明确退休。
  - 补齐工作日/夜班空批次、当前批次阻塞、病人顺序、公共工作内容、投诉/医闹活动及下班边界。

### P1：运行时已搭架构，但行为和持久化尚未闭合

- [ ] **TimeService / DayNightSystem 等价性**（未验证）
  - 验证初始 `day=1, 08:00, phase=day, duty=on-duty, location=work`。
  - 验证 `[08:00,16:00)` 工作窗口与 `[06:00,18:00)` 天文白昼不混用。
  - 验证 20 分钟普通行动、物品/法术时长、午夜加日、次日 08:00 只结算一次睡眠/医疗/收支/睡眠债。
  - 必须覆盖 `15:40 -> 16:00` 后 phase/duty/location 同步，而不只是 clock 改变。

- [ ] **四队列/活动恢复**（部分/未验证）
  - 工作、社交、主要、实时活动的实例、当前节点、已执行节点、等待输入、过期和阻塞状态需要逐项 round-trip。
  - 恢复后 runner 必须绑定恢复后的实例，不能继续使用 restore 前的活动对象。
  - 验证空批次 `{entries: []}` 与缺失文件的区别。

- [ ] **保存系统全量闭合**（未验证）
  - 对照旧版保存字段检查 GameState、TimeService、四队列、医疗病例、关键词、背包、NPC/SAN/好感度、场景物品、结局、公共变量、法术、动态活动、CG、窗口布局。
  - 明确当前保存版本与旧版本策略；新字段不能静默解释旧 payload。
  - 覆盖加载后活动继续、窗口恢复、公共变量引用恢复和失败恢复。

- [ ] **NPC、社交和宿舍**（部分/未验证）
  - NG 已有 NPC 数据、社交活动和宿舍活动，但需证明在线状态、好感度、SAN、角色立绘、社交入口和宿舍互动与旧版一致。
  - 验证高/低好感分支、同一时间多个社交活动、宿舍日程、角色离线及保存恢复。

- [ ] **ChatGTP**（数据已迁移，行为未验证）
  - `seed-records-chatgtp.json` 已承载大表，但需要验证关键词归一化、答案命中、离线答案、SAN 扣除、关键词揭示、重复查询和延迟加载完成前后的行为。
  - 验证 `corruptedAnswer`/正常答案、答案中的关键词 marker 和存档恢复。

- [ ] **关键词/笔记本**（部分/未验证）
  - 验证普通关键词固定实体、疾病 normal/low 两个固定 ID，以及从笔记本选择已收集疾病关键词时保持原版本。
  - 验证 marker 引用、收集上限、重复点击、保存恢复和 QA 查询使用同一 canonical ID 集合。

- [ ] **成就与引导**（数据/基础运行时已存在，未验证）
  - 对照旧版所有成就触发条件、一次性语义、累计条件、隐藏状态和保存恢复。
  - 引导 overlay 不得覆盖桌面根节点；验证 milestone 在业务成功点触发，失败/取消不计入。

### P2：编辑器、桌面和发布边界

- [ ] **数据编辑器覆盖矩阵**
  - 为 `media`、calendar、items、item placements、social apps、turtle soup、NPC、keywords、QA、diagnoses、medicines、locations、BGM、CG、endings、special events、public variables、structures/databases、activities、windows 建立“专用编辑器/通用入口/无编辑器”矩阵。
  - 不能把“可显示运行时记录”当作“可编辑源数据”。
  - 每个编辑器验证多窗口隔离、草稿完整保存、下载与写盘区分、未知字段保留和失败反馈。

- [ ] **蓝图编辑器旧版交互等价**
  - 验证三栏布局、类型优先检查器、端口类型过滤、SVG 线、临时连线、框选、Ctrl/Command 多选、多节点拖动、复制粘贴 ID 重映射、删除边清理、键盘快捷键、缩放和自动布局。
  - 验证 flow/value 边方向、分支动态端口、汇合多个 flow 输入、零坐标保存和重载。

- [ ] **窗口/桌面等价**
  - 验证桌面图标单击不打开、双击只打开一次、标题栏拖动/缩放/最大化恢复、任务栏、系统菜单和窗口布局保存恢复。
  - 验证窗口定义引用的 widget、活动和资产均能解析。

- [ ] **发布产物**
  - 执行 `node publish.js`。
  - 检查 `publish/` 不含 `DEV-TOOLS`、`DeveloperMode`、`dev-server.js`、NG 旧数据路径或被删除的内容注册表。
  - 执行发布版入口 `node --check publish/js/main.js`，并分别验证 NG 开发入口和玩家入口。

## 3. 已发现的 ID/数据缺口

### 旧版 ID 尚未在 NG 顶层 ID 集合中找到（37 个）

`book_blue_love`, `book_coc7`, `book_innsmouth`, `book_moon`, `book_nahan`, `book_wangxb`, `diagnosis-category`, `diagnosis-panel`, `dialogue`, `extra_workload`, `feast_set`, `frozen_meat`, `hotpot`, `ketchup`, `locked_box`, `medical-incidents`, `medicine-1`, `menu`, `mystery_potion`, `necklace_ajie`, `necklace_awei`, `necklace_binbin`, `old_key`, `opened_box`, `pasta`, `patient-list`, `perfume`, `physician_cert`, `poster_jesus`, `prescription`, `salt_bag`, `sandwich`, `statue_ajie`, `statue_awei`, `statue_binbin`, `submit`, `swastika`。

其中 `diagnosis-panel`、`dialogue`、`patient-list`、`prescription`、`submit` 等可能只是旧版 HIS widget ID，不应机械创建数据库记录；必须逐个映射到 NG window/widget 或标记为展示层兼容 ID。书籍、物品、家具类 ID 则必须确认是否进入 `inventoryItems`/物品放置/法术数据。

### 节点语义差异

- 旧版有而 NG 当前蓝图中没有同名节点：`endCg`, `getGlobal`, `hisRefresh`, `hisRenderDiagnosis`, `hisRenderPrescription`, `hisSelectPatient`, `hisSubmit`, `inventoryOperation`, `setGlobal`, `showCg`, `showImage`, `spellCast`, `spellEffect`。
- `segmentBranch` 在旧版有 21 次，当前 NG 统计为 0；即使其语义被其他通用节点替代，也需要针对边界值写等价性探针。
- `setGlobal/getGlobal` 已映射到公共变量节点，但必须验证 ID、类型、delta/value/toggle/setObjectRef 与旧版完全一致。
- `showCg` 等被改成 `emitEvent` 只能证明图形转换完成；没有事件消费者时是运行时缺口。

## 4. 重复/冗余数据审计与本次清理

扫描范围：`ng/data/**/*.json`、活动清单、活动日历、活动文件、`ng/engine.js` 和 NG 工具引用。

### 明确结果

- 没有发现字节级或规范化 JSON 完全相同的文件。
- 没有发现活动清单内重复活动 ID。
- 没有发现数据库同一 database 内重复主键。
- 发现 4 个“去掉 ID 后正文相同”的记录对，但均不是可安全删除的重复：
  - `keywords`: `symptom_163` 与 `disease:lymphadenopathy:normal` 都显示“淋巴结肿大”，但一个是症状实体，一个是疾病 normal 关键词；删除任一都会破坏引用和疾病关键词版本约定。
  - `specialEvents`: `游戏王の荣耀` 与 `一切谜锁都解开了` 都是空壳记录，但 ID 不同且来源中分别存在；它们是缺失内容的两个独立占位，不是同一记录。
- 发现 `medical_complaint_work`、`medical_riot_work` 未被当前 NG 日历/活动分类引用，但旧版 `workpub.json` 明确引用，故本次未删除；应先决定接入还是退休。
- 发现活动文件名 `ending__cn01`–`ending__cn15`、`event__cn01`–`event__cn07` 与活动定义内部中文 ID 不同。它们不是重复文件，而是 manifest 的文件名/定义 ID 不一致；应后续统一命名或增加校验，避免编辑器和调试器按文件名误定位。

### 本次实际删除

扫描确认没有可以在不改变语义的前提下直接删除的重复活动、重复数据库记录或重复 JSON 文件。以下删除的是已被 canonical NG 路径取代的旧版 raw-content 注册层，不是把两个有不同稳定 ID 的内容实体误合并：

- `ng/core/ContentDocumentStore.js`
- `ng/probes/content-document-store-probe.mjs`
- `ng/tools/migrate-legacy-content.mjs`
- `ng/dev/LegacyContentEditorView.js`
- `ng/data/legacy-content-manifest.json`
- `ng/data/legacy-content/zh-hans/` 下的旧版镜像内容

同时从 `ng/data/engine.json` 和 `ng/engine.js` 移除其加载与返回值。这避免了一个会复制旧版 JSON、但当前 manifest 为空且没有调用方的第二数据源。正式迁移数据现在只能进入 canonical NG 数据库、种子记录、活动 manifest 或窗口 manifest。

本次未删除以下“看起来相似”的记录：疾病关键词与同名症状关键词、不同事件/结局 ID 的空壳记录、不同日期/角色/分支的活动，以及 `medical_complaint_work`/`medical_riot_work`。它们仍有独立稳定 ID、旧版来源或引用关系，删除会造成内容丢失；待 P0 决定后再处理。

## 5. 下一轮建议顺序

1. 先为 `emitEvent` 的旧版领域操作建立事件消费者和确定性探针，尤其是 CG、HIS、物品、法术。
2. 接入或明确退休 `medical_complaint_work`/`medical_riot_work`，再处理活动 manifest 中的未引用数据。
3. 完成保存/恢复字段审计，再做工作/社交/睡眠边界探针。
4. 逐域补专用编辑器和真实开发入口验证。
5. 最后运行发布构建和浏览器交互验证；在此之前不能宣称旧版完全等效。
