# NG 引擎 Core / Framework / Game 分层审计报告

- 审计时间：2026-09-09T14:23:49Z
- 审计版本：`da42070353522241838145437d70e7a3e22b9cc0`
- 审计范围：`ng/` 引擎、内容包、蓝图数据、节点注册表、Activity 运行时、存档与开发人员模式
- 审计方式：静态代码审查、依赖/目录扫描、JavaScript 语法检查、JSON 校验、模块导入、Activity 蓝图校验、全部现有 `.mjs` 探针
- 浏览器验证：未执行。本报告不把静态检查或 Node 探针当作浏览器交互验证

## 1. 审计基准

本次审计以 `AGENTS.md` 中的 NGL 规范为准：

```text
仅 core 层允许使用原生 JavaScript
framework 和 game 层必须全部由 NGL 蓝图及数据实现
需要原生能力时，先加入通用、领域无关的 core 能力，再由 NGL 调用
依赖方向只能是 game → framework → core
```

Core 的允许职责包括仿 Win95 桌面、Activity 执行和调度、蓝图校验/求值、自定义窗口、通用数据结构、公共变量、局部变量、存档、开发人员模式和通用能力网关。具体游戏逻辑不应进入 core；framework 和 game 的业务逻辑不应以原生 JavaScript 实现。

## 2. 总体结论

**结论：不符合三层分层规范，当前状态为“蓝图运行基础已建立，但 framework/game 仍依赖原生 JavaScript”。**

已有基础：

- `ng/core/` 已形成 Activity、队列、窗口、变量、存档、数据加载和蓝图校验等通用模块
- `ng/data/blueprint-nodes.json` 已支持数据定义的自定义节点/宏节点
- 151 个 Activity 蓝图文件被扫描，151 个蓝图均通过当前 `ActivityValidator`
- 38 个现有 `.mjs` 探针全部通过
- 所有 73 个 NG JavaScript 文件通过 `node --check`
- 所有 189 个 NG JSON 文件通过 Python JSON 解析
- `ng/engine.js` 可通过 Node 模块导入

主要问题：

1. **P0：不存在独立 framework 层，game 层包含 11 个原生 JavaScript 模块，共约 783 行。**
2. **P1：局部变量尚未实现为 Activity 实例作用域；当前 `VariableStore` 是全局字符串键值表。**
3. **P1：`insertActivity` 的指定时间/执行池语义尚未实现，`addTime` 输入未被使用。**
4. **P1：函数/副作用节点的结果目前主要写入字符串键的 `VariableStore`，没有统一的“公共变量 ID 结果目标”契约。**
5. **P1：Activity 运行器仍在 core 中包含 `ending`、`text`、`choice` 等内容表现/结局语义，边界尚未完全通用化。**
6. **P2：节点分类器对部分非法端口组合的判定不完整，不能单独作为 NGL 四类节点契约的充分保证。**
7. **P2：公共变量实现与项目合同中的类型/ID范围描述不一致。**

## 3. 分层审计结果

### 3.1 Core 层

#### 已符合的部分

以下模块属于合理的通用宿主方向：

- `ng/core/ActivityRunner.js`
- `ng/core/ActivityExecutionService.js`
- `ng/core/ActivityQueue.js`
- `ng/core/ActivityQueueRegistry.js`
- `ng/core/ActivityValidator.js`
- `ng/core/ActivityNodeRegistry.js`
- `ng/core/WindowManager.js`
- `ng/core/WindowDefinitionStore.js`
- `ng/core/SaveManager.js`
- `ng/core/PublicVariableManager.js`
- `ng/core/DataLoader.js`
- `ng/core/DataStore.js`
- `ng/core/DataStructureManager.js`
- `ng/desktop/`
- `ng/dev/`

`ng/engine.js` 作为平台入口加载配置、创建 core 服务并加载内容包，方向上符合“平台入口 + 内容包”的目标。

#### 仍需拆分或审查的部分

`ng/core/ActivityRunner.js` 中存在以下内容语义：

- `ending` 节点，见 `ng/core/ActivityRunner.js:383-389`
- `text` 节点，见 `ng/core/ActivityRunner.js:452-469`
- `choice` 节点，见 `ng/core/ActivityRunner.js:471-492`
- `markOnboardingMilestone`，见 `ng/core/ActivityRunner.js:447-450`

其中 `text` 和 `choice` 可以保留为通用展示/输入原语，前提是它们只发送不透明的通用事件并由 NGL 数据声明接收者；但 `ending` 直接表达“结局”语义，`markOnboardingMilestone` 直接表达新手引导业务，建议迁移为 framework/game 的 NGL Activity，或降级为完全通用的事件/状态操作节点。

`ng/core/ActivityNodeRegistry.js:326-344` 仍注册了 `ending` 和 `markOnboardingMilestone`，因此不能只迁移运行器分支，还需要同步迁移节点注册、编辑器、校验器和数据。

### 3.2 Framework 层

当前仓库没有 `ng/framework/` 目录，也没有可识别的 framework 内容包或 framework NGL manifest。

`ng/data/engine.json:4` 只有一个 `contentPackage: "cultists.js"`，没有 framework 包装载边界。时间、输入输出、资源、数值、物品等系统没有以独立的 NGL framework 内容呈现。

这是结构性问题：当前实现实际上是：

```text
ng/engine.js + ng/core + ng/content/cultists/*.js + ng/data
```

而不是：

```text
core JavaScript → framework NGL → game NGL
```

### 3.3 Game 层

`ng/content/` 下存在 11 个原生 JavaScript 文件，共约 783 行：

- `ng/content/cultists.js`
- `ng/content/cultists/AchievementSystem.js`
- `ng/content/cultists/DialogueWidget.js`
- `ng/content/cultists/GameState.js`
- `ng/content/cultists/ItemManager.js`
- `ng/content/cultists/KeywordManager.js`
- `ng/content/cultists/LegacyContentEventGateway.js`
- `ng/content/cultists/MedicalCaseManager.js`
- `ng/content/cultists/NPCStateManager.js`
- `ng/content/cultists/OutcomeManager.js`
- `ng/content/cultists/SpellManager.js`

这些模块包含成就、物品、关键词、对话、医疗、NPC、结局和法术等明确 game 语义。例如：

- `ng/content/cultists.js:10-24` 创建物品、关键词和成就系统
- `ng/content/cultists.js:25-64` 生成 ChatGTP 关键词和分类选项
- `ng/content/cultists.js:88-109` 注册 game 运行时状态和存档 provider
- `ng/content/cultists.js:117-127` 注册 `content.item` 专用 API
- `ng/content/cultists/KeywordManager.js`、`MedicalCaseManager.js`、`OutcomeManager.js` 等直接实现领域状态和业务行为

这直接违反“framework/game 不得使用原生 JavaScript 编写业务逻辑”。当前这些代码应逐步替换为：

1. canonical JSON 数据
2. NGL Activity 和 manager Activity
3. framework 提供的通用集合、记录、变量、窗口、事件和 Activity 调度节点
4. 必要时由 core 提供领域无关的能力网关

`DialogueWidget.js` 如果只是通用动态窗口组件工厂，可以迁移到 core 的通用窗口能力或 framework NGL 定义；如果包含 Cultists 对话行为，则必须改为 NGL 数据和 Activity。

## 4. 运行时契约审计

### 4.1 局部变量：未实现

`ng/core/VariableStore.js:9-37` 只有一个全局 `values` Map，使用字符串 key；`ng/engine.js:88` 创建一个全局实例，并将它注入所有 Activity Runner。

`ng/core/ActivityInstance.js:8-23` 没有 `localVariables` 或局部变量快照字段。

因此当前状态是：

```text
所有 Activity 实例 → 共享同一个 VariableStore
```

而规范要求是：

```text
ActivityInstance → 自己的局部变量容器
Activity 结束 → 局部变量销毁
```

这会造成同名临时变量的跨 Activity 污染，也无法保证 Activity 实例之间的隔离。该问题属于运行时契约缺失，不是编辑器显示问题。

### 4.2 Activity 插入和执行池：语义不完整

蓝图注册表在 `ng/core/ActivityNodeRegistry.js:296-300` 为 `insertActivity` 声明了 `addTime` 输入，但：

- `ng/core/ActivityRunner.js:348-354` 没有读取 `addTime`
- `ng/engine.js:197-203` 的 `enqueueActivity` 只创建并追加实例
- `ng/engine.js:240` 对 `insertActivity` 只调用 `enqueueActivity`
- `ng/core/ActivityQueue.js:77-80` 只寻找第一个 `unresolved` 实例
- `ng/core/ActivityQueueConsumer.js:14-21` 只有被显式调用时才消费队列

所以当前 `insertActivity` 既没有保存游戏时间，也没有按指定游戏时间调度，更没有保证“进入执行池即开始执行”。`runActivity` 会直接启动 Runner，但 `insertActivity` 与它的语义不一致。

建议明确并实现以下字段：

```js
{
  scheduledGameTime: number | null,
  status: "scheduled" | "runnable" | "running" | "waiting" | "resolved",
  queueId: string,
  instanceId: string
}
```

如果采用“目标时间之前不进入执行池”，应由 core 的通用时钟协调器在到点后将实例变为 `runnable`；如果采用“入池即运行但延迟节点阻塞”，也必须保存等待状态并支持存档恢复。当前实现两者都没有完整实现。

### 4.3 函数结果和副作用结果目标：未统一

多个流程节点声明 `resultVariable`，例如 `createRecord`、`getRecord`、`callApi` 和 `getWindowLayout`，但这些结果写入的是 `VariableStore` 的字符串 key：

- `ng/core/ActivityRunner.js:397-404`
- `ng/core/ActivityRunner.js:406-430`
- `ng/core/ActivityRunner.js:341-346`

这与“带副作用流程节点通过额外的公共变量 ID 保存结果”的规范不一致。`addWindowComponent` 同时使用 `publicVariableId` 和字符串 `resultVariable`，说明当前系统存在两套结果协议。

建议统一为显式结果目标：

```json
{
  "scope": "public" | "local",
  "variableId": 12
}
```

并在节点 schema、编辑器、校验器、运行器和存档探针中统一处理。

### 4.4 流程/数值端口：大部分可用，但分类器仍有漏洞

当前 `ActivityValidator` 能够：

- 区分 `next` 流程边和 `inputs` 数值边
- 拒绝流程边与数值端口混接
- 检查端口类型兼容性
- 检查流程可达性
- 检查数值依赖环（由求值时的 stack 防护）

151 个 Activity 蓝图全部通过当前校验，说明已有数据与当前 schema 一致。

但 `ng/core/ActivityNodeRegistry.js:369-382` 的 `classifyActivityNodePorts` 存在边界漏洞：当节点同时拥有流程输出和数值输出、且没有流程输入时，会在 `hasValueOutput` 分支被分类为数值节点，而不是拒绝非法组合。四类节点契约要求该组合非法，建议先统一调用分类器校验所有内置和自定义节点，再将分类结果作为注册前置条件。

### 4.5 循环和安全上限

`ng/core/ActivityRunner.js:565-603` 允许流程回边，并使用 `MAX_STEPS = 1000` 防止无法终止的循环永久占用线程。这符合“允许开发人员连接回前面”的方向，也提供了最低限度的安全边界。

但超出步数时直接抛出异常，报告中未发现该异常在 `ActivityExecutionService.run()` 的启动路径中被统一转换为 Activity 的 `failed` 状态；应补充确定性探针，确认异常不会留下 `running` 实例、未清理的等待订阅或错误的队列状态。

### 4.6 异步等待

`blockUntil`、`text`、`choice` 使用 `waitingNodeId` 和事件订阅实现非阻塞等待，方向正确。当前等待唤醒事件主要是：

```js
"variable:changed"
"gameClock:changed"
```

见 `ng/core/ActivityRunner.js:540-558`。

这能覆盖变量和游戏时间等待，但不能覆盖通用外部事件等待。若 NGL 需要等待窗口输入、Activity 完成或其他事件，应将等待条件和订阅目标声明为可存档的通用等待协议，而不是依赖特定节点内部的事件列表。

## 5. 数据和启动边界审计

### 5.1 启动入口

`ng/engine.js:329-334` 在 `engine:ready` 后只启动配置中的 default Activity，这一点符合当前引擎边界；业务 Activity 列表没有被 engine 根据患者、日历或成就语义自动注入。

但 `ng/engine.js:124-127` 会动态导入 `./content/${contentModule}`，而该内容包是原生 JavaScript game 代码。作为加载机制本身没有问题，但在 NGL 规范下，内容包必须改为 NGL manifest/data package，不得承担 game 逻辑。

### 5.2 数据文件加载

`ng/engine.js` 通过 `DataLoader` 加载 JSON，配置中的 `contentRoot` 为 `data/`，没有发现硬编码 `data/zh-hans/` 的启动路径问题。

### 5.3 Canonical 数据与存档边界

`ng/core/SaveManager.js:82-101` 没有把 Activity/window/database 定义复制进存档，存档主要保存运行时变量、队列、窗口实例、图标布局、provider 和 runtime store；这是正确方向。

但当前 game 的 provider/store 由 `ng/content/cultists.js` 原生 JavaScript 注册，说明存档边界虽然存在，业务状态 owner 仍未迁移到 NGL Activity/framework 数据层。

## 6. 验证结果

### 6.1 通过的静态/运行时验证

| 检查 | 结果 |
| --- | --- |
| `node --check`：`ng/` 下 73 个 JS 文件 | 通过 |
| JSON 解析：`ng/` 下 189 个 JSON 文件 | 通过 |
| `node --input-type=module -e "await import('./ng/engine.js')"` | 通过，输出 `MODULE_IMPORT_OK` |
| Activity 蓝图扫描 | 151 个文件、151 个蓝图 |
| Activity 蓝图校验 | 151/151 通过 |
| `ng/probes/*.mjs` | 38/38 通过 |
| `git diff --check` | 审计前通过 |
| 浏览器启动和交互验证 | 未执行 |

### 6.2 验证限制

上述通过结果只能证明当前 JavaScript、JSON、蓝图 schema 和既有确定性探针彼此一致，不能证明：

- framework/game 已经完全脱离原生 JavaScript
- Activity 在浏览器中的执行池和异步恢复行为符合预期
- UI 交互路径在真实浏览器中可用
- 发布脚本能够完整剔除开发人员模式并保留 NGL 内容

## 7. 修复优先级

### P0：先建立真实三层边界

1. 创建 framework NGL 内容包和 manifest。
2. 将 `ng/content/cultists.js` 及其领域模块标记为迁移对象，不再新增原生 game JavaScript。
3. 把成就、物品、关键词、医疗、NPC、结局、法术和对话行为迁移为数据 + NGL Activity。
4. 将动态内容包加载从“import 原生 game JS”改为“加载 NGL framework/game 数据包”。
5. 增加发布边界扫描：`framework` 和 `game` 内容目录中不得存在 `.js` 业务模块。

### P1：补齐运行时语言契约

1. 为 `ActivityInstance` 增加局部变量 schema/value、snapshot/restore 和实例销毁语义。
2. 重新实现 `insertActivity` 的目标游戏时间、执行池入池、到期启动和存档恢复。
3. 统一函数/副作用节点的 `ResultTarget`，明确 public/local 作用域。
4. 把 `ending`、`markOnboardingMilestone` 等业务语义节点替换为通用事件/变量/Activity 组合。
5. 为等待 Activity 完成、外部事件和窗口输入建立通用可恢复等待协议。

### P2：补齐校验和质量门禁

1. 修正 `classifyActivityNodePorts` 对“流程输出 + 数值输出”组合的拒绝逻辑。
2. 对所有内置节点和数据自定义节点执行同一端口分类校验。
3. 为循环超限、Runner 异常、等待订阅清理和恢复失败添加确定性探针。
4. 统一 `AGENTS.md` 与 `PublicVariableManager` 的变量类型、ID 范围和 schema 文档。
5. 添加发布构建扫描，确认发布产物不含 content/game JavaScript 业务模块、开发人员模式入口或调试器。

## 8. 最终判定

当前 NG 引擎已经具备可运行的 NGL 蓝图执行基础，但尚未达到目标架构：

```text
目标：game NGL → framework NGL → core JavaScript
现状：game JavaScript + game JSON → core JavaScript
```

因此本次审计结论为：

> **蓝图运行核心：部分符合。三层分层规范：不符合。必须先完成 game/framework 的原生 JavaScript 迁移，以及局部变量和 Activity 调度契约补齐，才能宣称 NGL 三层架构落地。**
