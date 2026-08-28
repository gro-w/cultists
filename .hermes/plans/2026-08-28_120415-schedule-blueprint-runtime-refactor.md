# 日程蓝图与运行时系统大重构实施计划

> **For Hermes:** 先获得用户审批，再使用 subagent-driven-development 按任务逐项实现；本计划阶段不执行实现代码。

**Goal:** 将当前以 `dialogueTree` 为核心的日程系统升级为统一的、可执行的日程蓝图系统，使日期日程、物品日程、事件日程、结局日程和公共日程都由同一套节点图、类型化引脚、日程实例状态和执行器驱动。

**Architecture:** 保留 `work` / `social` 两条可见队列，但队列元素统一成为带稳定 `scheduleId`、递增实例序号和 `instanceId` 的日程实例。新建日程蓝图模型、值求值器和流程执行器：流程节点负责推进执行，纯数值节点按依赖递归计算；类型化连接在编辑器保存和运行时加载时进行校验。蓝图继续使用当前对象式节点结构（`nodes: { nodeId: node }`），不改为数组式节点结构。旧数据采用明确的迁移层，不能让旧字段悄悄丢失；所有来源（日历、物品、特殊事件、结局、公共日程）最终转换为统一日程定义。

**Tech Stack:** 原生 HTML/CSS/ES6 modules、JSON 数据、现有 `EventBus`、`DataLoader`、`SaveManager`、Win95 窗口系统；无构建步骤、无新依赖。

---

## 需求边界与需要审批的设计决定

1. **日程定义与日程实例分离**
   - 日程定义属于某个日程表，包含蓝图和元数据。
   - 日程实例进入队列后才拥有状态：`pending`（未解决）或 `completed`（已解决）。
   - `instanceId` 采用 `scheduleId + 实例序号` 的稳定形式；序号由对应日程 ID 的实例计数器生成，不能使用当前数组长度作为长期身份。
   - “结局”也是日程定义，但结局实例完成后触发游戏结束并显示结局画面。

2. **蓝图 schema**
   建议统一为：
   ```json
   {
     "id": "schedule-id",
     "name": "显示名称",
     "blueprint": {
       "nodes": {
         "node-start": {
           "id": "node-start",
           "type": "flowStart",
           "x": 80,
           "y": 80,
           "inputs": {},
           "outputs": {}
         }
       },
       "connections": [],
       "startNodeId": "node-start"
     }
   }
   ```
   节点使用稳定 `id`、`type`、`x`、`y`、`inputs`、`outputs`。继续沿用当前对象式 `nodes`，流程端口与数值端口在节点对象中显式声明类型；连接记录源节点/端口和目标节点/端口。实现时保留现有 JSON 外层元数据（患者、联系人、物品、事件字段），只把执行内容迁移到 `blueprint`。

3. **节点语义**
   - 流程节点：`flowStart`、`text`、`choice`、`branch`、`consumeTime`、`setGlobal`、`insertSchedule`、`showCg`、`inventoryOperation`、`statOperation`。
   - 数值节点：`arithmetic`、`getGlobal`、`getInventory`、`getProtagonistStat`、`getScheduleStatus`、`getScheduleInstanceCount`、`getGameTime`。
   - 节点元数据集中注册，注册表同时提供端口定义、输入值类型、输出值类型、编辑器标签和运行时执行器；禁止在编辑器和运行时各维护一套不一致的节点类型列表。
   - `displayText` 的说话人 ID和文字是两个数值输入；`choice` 的分支数量是动态端口结构；`branch` 的 `0`/`true` 分支规则固定并在运行时统一处理。
   - `consumeTime` 具有 1 个流程输入、1 个流程输出和 1 个数值输入；数值输入表示消耗的游戏时间，按现有行动时间规则校验并推进绝对游戏分钟，不能读取真实系统时间。
   - “一个节点不能同时有流程输出和数值输出”作为 schema 校验不变量；流程节点不能被数值连接，数值端口不能被流程连接。

4. **数值与操作语义**
   - 数值输入既可以是常量，也可以连接数值节点；纯数值节点无流程端口，可在流程节点需要时递归求值。
   - 运算定义覆盖加、减、乘、除、字符串拼接、与、或、异或、大于、小于、等于、非；除法除零、布尔转换、字符串转换要有确定规则并写入文档/探针。
   - `insertSchedule` 的输入是日程 ID、插入时间、目标队列；第三个输入强制覆盖日程定义来源。目标队列非法时返回确定错误，不静默回退。
   - `statOperation` 的数值 ID覆盖所有现有数值系统，包括主角数值、NPC SAN、好感度、ActionBudget、金钱及其他公开数值；先审计各 manager 的写入 API，再建立统一数值 ID映射。
   - `getScheduleStatus` 返回 `不存在`、`未解决`、`解决` 的内部枚举值，编辑器显示本地化标签；`getScheduleInstanceCount` 按稳定 `scheduleId` 统计定义已创建的实例。
   - `getGameTime` 输出绝对游戏分钟，避免字符串参与时间运算。

5. **来源日程表**
   - 日期日程：`work01a/b.json`、`social01a/b.json` 至 `07`，在时间检查点创建日程实例。
   - 物品日程：在 `items.json` 的每个物品内新增调查、使用、获得、失去四个日程表字段；执行器由 `ItemManager` 的对应成功事件触发。
   - 公共日程：`workpub.json`、`socialpub.json`，只通过插入日程节点/公共操作创建实例，不自动入队。
   - 事件日程：`special_events.json` 改为事件定义引用或内嵌日程表，事件条件匹配后创建/执行对应日程。
   - 结局日程：`endings.json` 的结局蓝图完成时触发结束和结局画面；与其他所有结局使用同一处理路径，目前不增加第 7 天专用结局规则。

---

## 实施任务

### 阶段 0：冻结现状并建立迁移基线

1. 重新审计 `AGENTS.md`、现有日程/物品/事件/结局 JSON，确认当前工作区干净且不触碰用户本地数据。
2. 建立数据清单：所有日程 ID、重复 ID、所有 `dialogueTree`、物品效果、事件/结局入口、存档字段和 UI 消费点。
3. 编写只读 schema 审计脚本（建议放在 `scripts/` 或 `.hermes/`，不增加运行时依赖），输出缺失 ID、重复 ID、孤儿引用和旧格式计数。
4. 明确现有 `SaveManager` v11 的兼容策略：新蓝图状态必须升级存档版本；旧存档应经过一次明确迁移或被清晰拒绝，不能静默将旧对话进度映射成错误的实例状态。

**重点文件：** `js/core/ScheduleData.js`、`js/core/ScheduleQueue.js`、`js/core/ItemManager.js`、`js/core/SpecialEventManager.js`、`js/core/EndingManager.js`、`js/core/SaveManager.js`、`data/zh-hans/*.json`。

### 阶段 1：建立统一日程定义、实例和队列模型

1. 新建 `js/core/ScheduleDefinition.js`：定义日程表/日程定义的规范化结构、来源类型和 schema 校验。
2. 重构 `js/core/ScheduleQueue.js`：实例使用稳定 `scheduleId` + 单独计数器生成 `instanceId`；支持状态读取、完成、按定义 ID 统计、按实例 ID 查询和 snapshot/restore。
3. 重构 `js/core/ScheduleData.js`：加载所有来源日程表到统一索引；保留日期检查点、公共日程计时器和先决条件；自动/插入触发统一调用 `scheduleQueue.appendScheduleInstance()`。
4. 增加 `js/core/ScheduleRegistry.js`（或并入定义模块）：提供 `getDefinition(scheduleId)`、来源表索引和所有实例/定义查询，供数值节点和编辑器使用。
5. 为日程定义加入 `onComplete`/结束语义：普通日程完成只标记实例；结局日程完成调用 `EndingManager` 的统一结束入口。

**验收：** 同一日程创建多次时实例 ID 不重复；两个队列可恢复 pending/completed；公共日程不自动入队；先决条件仍在实例创建时判定。

### 阶段 2：建立节点类型注册表、端口和蓝图校验器

1. 新建 `js/core/ScheduleNodeRegistry.js`：集中注册 17 类节点、显示标签、流程/数值端口、输入类型、输出类型和执行器名称。
2. 新建 `js/core/ScheduleBlueprint.js`：负责默认蓝图、规范化、旧 `dialogueTree` 迁移、节点/连接 ID生成和 schema 校验。
3. 实现端口连接校验：节点存在、端口存在、方向正确、流程/数值类型一致、禁止同一节点同时拥有流程输出和数值输出、`flowStart` 恰好一个且必须可达。
4. 实现动态端口规则：点击分支的每个按钮输出和对应文字输入；分支 n 至少满足一个流程输出和 n+1 个数值输入；端口增删时保持连接可审计。
5. 更新 `docs/DATA-SCHEMAS.md`，给出完整节点/端口/连接示例和每种操作的参数类型。

**验收：** 对非法连接、缺少起点、多个起点、数值/流程错接、数值输出节点带流程端口分别得到确定错误；合法最小蓝图通过。

### 阶段 3：实现数值依赖求值器

1. 新建 `js/core/ScheduleValueEvaluator.js`，从流程节点输入追踪数值连接，递归计算纯数值节点。
2. 加入循环依赖检测、缺失节点/端口处理和每次执行实例内的求值缓存；禁止读取浏览器墙钟时间。
3. 实现 `arithmetic` 的所有运算符及确定的类型转换、除零和非法输入规则。
4. 接入公共变量、背包数量、主角数值、日程实例状态、日程实例数量和当前绝对游戏时间读取器。
5. 为调试模式提供节点求值 trace（输入值、输出值、失败原因），正式版本不保留开发 UI/日志路径。

**验收：** 常量、嵌套运算、布尔逻辑、字符串拼接、状态读取、循环依赖、未知 ID 和除零均有确定探针结果。

### 阶段 4：实现流程执行器与 17 类节点运行时

1. 新建 `js/core/ScheduleRunner.js`：从唯一 `flowStart` 开始，执行一个日程实例；每次只推进到下一个流程节点，等待用户点击或 UI 回调的节点暂停。
2. 实现 `text`：计算说话人 ID与文字后通过现有 app 渲染回调显示；兼容主控、NPC、其他、无说话人。
3. 实现 `choice`：计算按钮文本，显示 n 个分支，点击后沿对应流程输出继续；流程输入和分支状态必须可存档/恢复。
4. 实现 `branch`：求值为 0 走 false 输出，为 true 走 true 输出；非布尔数值采用文档规定的 truthiness。
5. 实现 `consumeTime`：计算唯一数值输入，按游戏时间推进 API 消耗指定分钟，并在非法、负数、非 20 分钟粒度或超出第 7 天边界时返回确定错误；时间推进触发既有日程计时器、阶段和事件语义。
6. 实现 `setGlobal`、`insertSchedule`、`showCg`、`inventoryOperation`、`statOperation`，统一通过核心 manager 和 EventBus 修改状态；失败操作要返回确定结果而不是吞错。
7. 实现普通日程结束、结局日程结束、用户取消/关闭窗口和异常节点的状态收束。
8. 将 `DialogueEffects.js` 的旧 `onShow` 副作用迁移成兼容适配器或删除；确保不能同时执行旧副作用和新蓝图副作用造成双重发放。

**重点文件：** 新建 `ScheduleRunner.js`、`ScheduleValueEvaluator.js`；修改 `DialogueRunner.js`、`DialogueEffects.js`、`EndingManager.js`、`GlobalVariableManager.js`、`ItemManager.js`、`GameState.js`。

### 阶段 5：迁移所有日程表来源

1. 日期日程文件：将每个现有 actor/patient/contact 的 `dialogueTree` 迁移为日程定义/蓝图，保留稳定 ID、角色元数据和 authored 文本。
2. 物品 schema：在 `items.json` 中为每个物品加入四类日程表，提供空表默认值；将现有调查、使用、获得、失去效果转成蓝图节点或兼容包装。
3. 公共日程：保留 `workpub.json`/`socialpub.json`，改为统一公共日程定义，插入日程节点使用其稳定 ID创建实例。
4. 事件日程：重构 `SpecialEventManager.js`，匹配事件后执行/创建事件日程；保留 NPC、日期、好感、SAN、公共变量筛选。
5. 结局日程：重构 `EndingManager.js`，让结局蓝图完成进入 ending screen；旧 stat/final condition 作为触发入口，避免重新实现条件逻辑。
6. 更新 `DataLoader` 加载依赖和 `main.js` 启动顺序，确保注册表、日程定义、物品和结局在首次执行前完成初始化。

**验收：** 每个来源至少有一个确定性样例；检查旧 authored 内容数量与迁移后数量一致；所有引用 ID可解析。

### 阶段 6：接入 HIS、聊天 App 和其他 UI

1. 修改 `HISApp.js`：从患者日程实例启动 `ScheduleRunner`，显示完成/未完成状态，完成后只完成当前实例。
2. 修改 `SocialApp.js`：以同一 runner 驱动室友日程实例，确保和 HIS 的点击、分支、暂停/恢复语义一致。
3. 修改 `MonitorApp.js`、`DormMode.js`、`ChatGTPApp.js`：若它们仍展示对话树，统一改用 runner 或明确作为只读/观察入口，禁止复制执行逻辑。
4. 修改 `DialogueProgress.js` 或替换为 runner checkpoint：持久化当前实例 ID、当前流程节点、等待输入状态；旧对话进度提供迁移映射。
5. 更新任务栏、窗口关闭/重开和 phase 切换事件：同一实例不能因重渲染或重新打开窗口重复执行副作用。

**验收：** HIS 与聊天 App 使用同一个蓝图实例执行器；完成状态、队列状态、窗口重开、分支选择和结局触发一致。

### 阶段 7：将对话节点编辑器改为日程编辑器

1. 将 `DevDialogueEditorTab.js` 重命名/改名为日程编辑器入口（保留必要的兼容导出，避免开发入口断裂）。
2. 以 `ScheduleNodeRegistry` 生成“新建节点种类”菜单；显示节点类型、输入引脚、输出引脚和端口类型。
3. 将现有节点画布连接模型扩展为流程/数值两种端口：拖拽时实时拒绝类型不匹配连接；保存前运行完整 schema 校验。
4. 实现各类节点的属性面板：常量输入、ID选择器、运算符、动态分支端口、CG ID、队列和时间输入；数值输入可切换常量/节点连接，并为“消耗时间”节点提供时间数值输入和粒度/边界校验提示。
5. 保留并升级现有坐标持久化、选项引脚、自动排布、删除节点清理连接、窗口交互和 JSON 导出/写盘路径。
6. 编辑器加载时显示当前游戏的日程表来源：日期、公用、物品、事件、结局；写盘按来源文件保护未加载文档，避免空草稿覆盖源数据。
7. 新增蓝图预览/校验错误面板：缺起点、孤立流程节点、错误端口类型、循环数值依赖、未知 ID均可定位到节点。
8. UI 标题、按钮、提示和文档从“对话”改为“日程”，并保持严格 `?dev` 的开发入口边界。

### 阶段 8：存档、迁移与完整验证

1. `SaveManager.js` 升级格式版本，保存：队列实例、实例计数器、当前 runner checkpoint、待处理插入日程计时器、物品/事件/结局执行状态。
2. 对旧 v11 存档实现显式迁移测试；无法无损映射的情况返回明确错误，不改变原始 URL，不静默清空状态。
3. 增加确定性探针：
   - 最小日程蓝图执行；
   - 文字、点击分支、逻辑分支、消耗时间；
   - 所有运算符和边界输入；
   - 全局变量/物品/主角数值读取与写入；
   - 插入日程时间到达前后；
   - 日程状态与实例数量；
   - CG 开关；
   - 物品四类触发；
   - 事件和结局完成；
   - HIS/聊天队列实例状态；
   - 存档 round-trip 和旧存档迁移/拒绝。
4. 执行静态检查：所有受影响 JS `node --check`、全部 JSON 解析、schema/ID/引用审计、`git diff --check`、LF 检查。
5. 执行 `node publish.js`，确认发布目录不含 `DEV-TOOLS`、`DeveloperMode`、开发编辑器或开发服务器代码，并检查发布入口语法。
6. 用户明确要求时再做浏览器 UI 验证；默认不主动打开浏览器，先报告静态和脚本探针结果。

---

## 预计文件变更

**新增：**
- `js/core/GameRules.js`（若现有版本仍保留，复用）
- `js/core/ScheduleDefinition.js`
- `js/core/ScheduleRegistry.js`
- `js/core/ScheduleNodeRegistry.js`
- `js/core/ScheduleBlueprint.js`
- `js/core/ScheduleValueEvaluator.js`
- `js/core/ScheduleRunner.js`
- schema 审计/确定性探针脚本（建议 `scripts/`）

**重点修改：**
- `js/core/ScheduleData.js`
- `js/core/ScheduleQueue.js`
- `js/core/ScheduleOperations.js`
- `js/core/DialogueRunner.js`
- `js/core/DialogueEffects.js`
- `js/core/ItemManager.js`
- `js/core/GlobalVariableManager.js`
- `js/core/GameState.js`
- `js/core/SpecialEventManager.js`
- `js/core/EndingManager.js`
- `js/core/SaveManager.js`
- `js/apps/HISApp.js`
- `js/apps/SocialApp.js`
- `js/apps/MonitorApp.js`
- `js/apps/ChatGTPApp.js`
- `js/desktop/DormMode.js`
- `js/desktop/DeveloperMode.js`
- `js/desktop/DevDialogueEditorTab.js`（最终改名为日程编辑器入口）
- `docs/DATA-SCHEMAS.md`
- `docs/ARCHITECTURE.md`
- `data/zh-hans/work01a/b.json` 至 `work07a/b.json`
- `data/zh-hans/social01a/b.json` 至 `social07a/b.json`
- `data/zh-hans/workpub.json`、`socialpub.json`
- `data/zh-hans/items.json`、`special_events.json`、`endings.json`

**明确不应触碰：**
- `data/zh-hans/chatgtp_qa.json` 的现有本地修改，除非用户另行授权；
- 与本次迁移无关的内容、资产和用户工作区修改。

---

## 风险与应对

- **范围过大：** 分阶段提交，每阶段先通过 schema/运行时探针，再进入下一阶段；不要一次性替换所有数据。
- **旧数据丢失：** 迁移脚本必须保留 authored 文本、角色字段、稳定 ID和附加元数据，并输出迁移前后数量对比。
- **副作用重复执行：** 新 runner 与旧 `DialogueEffects` 只能有一个权威执行路径；每个副作用用事件/计数探针验证只发生一次。
- **数值图循环：** 求值器必须维护递归栈并返回明确错误；编辑器保存前阻止循环蓝图。
- **队列错投：** 队列归属规则在 schema、registry、运行时和编辑器中只定义一次；插入日程节点的第三个队列输入强制覆盖来源定义，非法队列必须明确报错。
- **存档不可兼容：** 升级存档版本并保留旧版拒绝/迁移分支；严禁用 clamp 把第 8 天、未知实例或缺失节点变成看似有效状态。
- **开发版泄漏：** 日程编辑器和诊断代码继续使用 `DEV-TOOLS:START/END`，发布脚本验证产物。
- **UI 交互回归：** 复用现有 Pointer Events、窗口控制、选项引脚和 EventBus 清理逻辑；先做静态/脚本验证，再按用户要求做浏览器验证。

## 交付策略

这是跨运行时、数据 schema、存档、多个 App 和开发工具的破坏性大重构。审批后应使用独立分支和 Pull Request，不应直接在 `main` 上一次性提交。每个阶段可有小型 Conventional Commit，但最终合并走 PR；远端 CI 状态必须与本地验证分开报告。

## 已确认的设计决定


1. 蓝图继续使用当前对象式 `nodes: { id: node }` 结构。
2. `insertSchedule` 的第三个“被插入的日程队列”强制覆盖日程定义来源。
3. `getGameTime` 输出绝对游戏分钟。
4. 物品的调查、使用、获得、失去四个日程表直接嵌套在物品对象中。
5. 普通日程实例完成后允许重复打开查看，但不能再次选择或执行；队列保留已完成实例及显示文本记录。
6. “操作数值”的数值 ID覆盖所有现有数值系统，包括主角数值、NPC SAN、好感度、ActionBudget、金钱及其他公开数值。
7. 第 7 天结局与其他所有结局使用同一处理方式，目前不增加特殊结局规则。
