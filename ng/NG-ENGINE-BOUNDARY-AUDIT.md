# NG 引擎边界代码审计报告

审计对象：当前工作区的 `ng/` 实现

审计目标：验证 NG 是否只提供桌面/窗口、蓝图 Activity 运行、存档、公共变量、自定义数据结构与数据库、新手引导编辑器、开发人员模式；验证所有游戏业务是否通过内容数据、自定义窗口和 Activity/管理器 Activity 建立；验证 Activity 调度是否由管理器 Activity 显式完成。

## 结论

当前实现已经具备一部分正确的分层方向，但**尚未达到严格的引擎/游戏数据分离**。主要问题不是缺少 Activity API，而是 NG 平台入口和 `ng/core/` 仍然直接拥有 Cultists 业务对象、业务事件和业务推导逻辑。

按严重度：

- **P0：4 项**——会直接破坏引擎可复用性或违反“所有调度由管理器 Activity 显式完成”的核心边界
- **P1：6 项**——当前行为可能工作，但会使内容层无法独立替换或使引擎隐式拥有游戏语义
- **P2：4 项**——清理性、契约性和未来扩展问题

原始审计阶段没有修改业务代码；后续实施阶段依据本报告完成了边界分离改造。工作区中与本任务无关的既有修改保持不动。

## 实施复核（本次边界分离）

本报告提出的边界改造已落地到当前工作区：

- `ng/engine.js` 不再导入或实例化成就、物品、关键词、患者、NPC、结局、法术和游戏状态管理器；平台通过 `config.contentPackage` 动态加载内容包
- 业务管理器、对话控件和遗留内容事件网关已移入 `ng/content/cultists/`
- `DesktopShell` 通过内容包注入自定义 widget factory，不再直接依赖对话控件
- `SaveManager` 使用通用 `stateProviders`、`runtimeStores` 和 `saveableVariable` 注入点，不再硬编码关键词和 Cultists 派生变量
- 物品 API 不再直接执行物品副作用或内联蓝图，而是注册 Activity 定义并向 Activity 队列追加实例
- 公共变量 `syncSource` 已由 `PublicVariableManager` 的通用同步机制连接到游戏时钟，时间值不再由第二套业务状态保存
- 蓝图 API 已暴露队列枚举、读取、追加、更新、完成、取消、移除、消费，以及 Activity pause/resume/cancel
- 领域调度器不再位于 `ng/core/`；旧实现仅保留在 `ng/tools/legacy-ActivityScheduler.mjs` 供迁移探针使用

复核结果：所有 `ng/probes/*.mjs` 探针通过；相关 JavaScript `node --check` 通过；`git diff --check` 通过。尚未进行浏览器 UI 交互验证，也未提交或推送。

## 符合项

### 1. 默认 Activity 的启动入口方向正确

`ng/engine.js:423-427` 在 `engine:ready` 后只根据 `config.defaultActivity` 加入并消费启动 Activity。这符合“ready 时只启动 default 列表”的目标方向。

`ng/data/activities/default.json:3-19` 也尝试将患者、室友剧情和成就管理器作为 Activity 加入流程，而不是让引擎直接按患者/日历语义排队。

但这一点被后文的引擎业务代码和未接入的调度器削弱，不能单独视为整体合规。

### 2. Activity 队列已有基础的通用读写接口

- `ng/core/ActivityQueue.js:17-115` 提供 append、get、list、update、remove、complete、cancel、snapshot、restore
- `ng/core/ActivityQueueRegistry.js:24-64` 提供按 queueId 的 append、读取、更新、完成、取消、快照和恢复
- `ng/core/ActivityExecutionService.js:67-109` 提供 append、read、list、update、complete、cancelEntry、pause、resume、cancel
- `ng/engine.js:429` 对外返回了 enqueue、run、read、list、update、complete、cancel、consume 等 Activity API

基础能力已经存在，问题是这些能力没有完整、稳定地暴露给蓝图的通用 API 边界，且 `callApi` 只注册了 `engine.queue.list`，不能由内容蓝图直接调用完整的队列管理面。

### 3. 数据库和存档边界已有正确意图

`ng/core/DataStore.js:1-9` 明确将自定义数据库作为数据层，并通过结构校验保护写入；`ng/core/SaveManager.js:9-15,35-38` 明确声明内容定义不应复制进存档。

这是正确方向。但 SaveManager 仍直接依赖关键词管理器、OnboardingManager 和由引擎组装的物品运行时，仍需改成通用的可注册状态提供者机制，见 P1-5。

### 4. GameClock 没有使用真实系统时间

`ng/core/GameClock.js:5-8,22-33` 只在显式 `advance()` 时推进，没有使用 `Date`、`setInterval` 或系统时钟。这符合确定性运行时要求。

但“游戏时间属于公共变量”的要求目前没有落实，见 P0-3。

## P0：必须优先修复

### P0-1：`engine.js` 直接创建并持有游戏业务系统

证据：

- `ng/engine.js:33-35` 直接导入 `KeywordManager`、`AchievementSystem`、`ItemManager`
- `ng/engine.js:123-127` 直接创建物品和关键词管理器
- `ng/engine.js:162-181` 直接创建成就系统，并向窗口运行时集合提供 `achievementStates`
- `ng/engine.js:182-184` 直接提供 `inventoryItems`

这些类即使看起来是“通用管理器”，当前仍以 Cultists 的业务概念为中心：关键词、成就、物品、库存不属于 NG 的七项基础能力。引擎不应知道这些概念，更不应将其作为平台启动必需组件。

额外证据：

- `ng/engine.js:130-147` 自己拼装疾病关键词、药品关键词和笔记本关键词
- `ng/engine.js:125` 直接加入 `physician_cert` 物品
- `ng/core/AchievementSystem.js:20-24` 内置“未完成患者”推导
- `ng/core/AchievementSystem.js:43` 直接按 `achievement__${id}` 运行成就 Activity

修复边界：

1. `ng/engine.js` 只创建平台服务，并加载一个内容包入口，例如 `ng/content/<package>.js`
2. `KeywordManager`、`ItemManager`、`AchievementSystem` 及其窗口集合移入内容包
3. 引擎只提供通用运行时状态注册、事件订阅、Activity 调度和存档 provider 注册能力
4. “成就解锁后运行哪个 Activity”“患者队列有多少未完成项”只能在内容管理器 Activity 或内容 API 中表达

### P0-2：引擎仍提供业务 Activity 的直接执行路径

证据：

- `ng/engine.js:272-278` 注册 `engine.itemAction`，引擎直接判断 `use/inspect`、调用 `itemManager.use()`，然后插入物品蓝图
- `ng/engine.js:327-343` 的 `executeActivity()` 直接选择窗口、数据库、公共变量和内容 API gateway
- `ng/engine.js:380-389` 直接为窗口、组件、桌面图标安装业务生命周期执行路径

窗口生命周期和桌面图标属于平台能力，可以保留；但 `engine.itemAction` 明确是物品业务 API，不应在平台入口中存在。物品按钮应触发一个由内容包注册的通用 Activity/API，消费、调查、使用和后果由内容蓝图完成。

修复边界：

- 引擎保留通用 `callApi` 注册点，不内置 `engine.itemAction`
- 内容包注册 `content.itemAction` 或等价内容 API
- 消费物品不能由引擎在入队前直接完成；应由物品 Activity 的效果节点执行，才能拥有可保存、可恢复、可观察的 Activity 语义

### P0-3：游戏时间仍是引擎私有 `GameClock`，没有成为公共变量

证据：

- `ng/engine.js:84-88` 创建私有 `GameClock` 和 `TimeService`
- `ng/engine.js:54` 的 `engine.consumeTime` 直接调用 `timeService.consume()`
- `ng/data/public-variables.json:891-896` 声明公共变量 1000 的 `syncSource: gameClock.totalMinutes`，并声称由引擎自动同步
- 全仓库实际搜索只找到该声明和 `GameClock` 事件，没有找到将 `gameClock:changed` 写入公共变量 1000 的实现
- `ng/core/PublicVariableManager.js:64-66` 只保存 `syncSource` 字段，没有解释或执行同步

因此当前存在“数据契约声称有同步、运行时没有同步”的断裂。管理器 Activity 使用公共变量 1000 的条件可能永远读取初始值。`ng/core/ActivityRunner.js:545` 监听时钟事件只能唤醒等待者，不能代替公共变量同步。

修复边界：

- 最终确定时间公共变量的通用表示和预留 ID
- 时间推进的通用效果必须在一次 Activity 执行中更新公共变量
- 若保留 `GameClock` 作为高效内部索引，它只能是公共变量系统的实现细节或派生缓存，不能成为第二个可独立变化的状态源
- `phase`、`duty`、`location` 等业务字段也应由内容公共变量定义和 Activity 效果维护，而不是放在平台配置后被平台忽略

### P0-4：引擎内部存在可自动按日历/工作/社交调度的 `ActivityScheduler`

证据：

- `ng/core/ActivityScheduler.js:40-56` 固定遍历第 1–7 天、`work` 和 `social`
- `ng/core/ActivityScheduler.js:3-5` 固定使用 08:00 和 16:00 检查点
- `ng/core/ActivityScheduler.js:100-120` 自动按时间把 Activity 追加到工作/社交队列

当前 `engine.js` 没有实例化它，这是暂时避免实际越界；但该类本身已经把患者/社交调度模型的一部分写进核心。只要未来有人接入它，就会恢复“引擎依据时间和队列语义自动创建 Activity”的模式。

修复边界：

- 删除 `ActivityScheduler`，或重写成不理解日期、工作、社交和固定检查点的纯通用“事件/时间条件索引器”
- 患者管理器、剧情管理器和其他内容管理器 Activity 使用 `blockUntil`、公共变量条件、数据库查询和 `insertActivity` 自己调度
- `ActivityQueue` 只处理队列，不检查 NPC、患者、日历和成就语义

## P1：需要在边界重构阶段修复

### P1-1：default Activity 数据加载范围过大，启动清单混入业务活动

`ng/engine.js:235-249` 从所有 `activityLists` 合并 Activity ID；`ng/data/engine.json:20-30` 将 medical、social、dorm、achievement、ending 等内容清单都配置在平台启动配置中。

加载 Activity 定义本身可以是平台能力，但当前平台配置同时描述了大量 Cultists 业务清单。更严格的分层应是：平台只接收内容包提供的 default Activity 与按需 Activity manifest；业务清单、管理器和内容索引由内容包拥有。

### P1-2：默认内容管理器没有完全实现“阻塞直到条件”的行为

`ng/data/activities/achievement-manager.json:8-22` 只发出 `achievement:manager-ready` 后结束，没有 `blockUntil` 或循环等待条件。与此同时，真正处理成就事件的是 `ng/core/AchievementSystem.js:14-35` 的引擎对象，而不是该 Activity。

这意味着“成就管理器 Activity 阻塞等待并解锁成就”的目标在数据层只是名义上的。患者和室友剧情管理器虽然包含大量 `blockUntil`/`insertActivity`，但它们依赖公共变量 1000，而当前时间同步缺失。

### P1-3：内容数据库和运行时数据库没有彻底区分

`ng/core/DataStore.js:122-135` 提供了 `toJSON()`/`restore()`，说明数据库具有运行时恢复能力；但 `SaveManager` 当前没有保存 DataStore，而是把部分运行时对象单独放入 `runtimeStores`。

这会造成两个容易混淆的边界：

- canonical 内容记录，例如患者定义、物品定义、成就定义，不应进存档
- Activity 产生的玩家状态，例如库存、已提交病例、成就解锁状态，才可以作为内容包注册的 runtime store 进存档

应将这两类注册为明确不同的 `contentStore` 和 `runtimeStateProvider`，禁止内容编辑器和存档调试器复用同一个写入接口。

### P1-4：`VariableStore` 与公共变量系统并存，游戏状态可落入非公共变量 RAM

`ng/core/VariableStore.js:1-7` 明确说它是 Activity runtime 的临时 stand-in；但 `ActivityRunner` 仍大量使用 `setVariable`、`getVariable` 和 `event:value`，而 `SaveManager` 又保存可序列化的 `VariableStore` 值。

作为 Activity 局部临时变量可以保留；但玩家可见或跨 Activity 的主角数值不能进入它。当前需要明确三类作用域：

1. Activity 实例局部临时值
2. 公共变量 RAM
3. 内容数据库 ROM

并在节点验证器中阻止把玩家状态写入任意字符串变量，或至少在契约上明确局部变量不可作为游戏持久状态。

### P1-5：SaveManager 不是纯通用存档系统

`ng/core/SaveManager.js:57-84` 直接接收 `keywordManager`、`onboardingManager` 和 runtime stores；`ng/core/SaveManager.js:107-109,177-180` 直接知道关键词、引导和业务运行时结构。

新手引导是用户声明的引擎能力，可以由引擎提供通用 milestone store；关键词不是平台能力，应由内容包注册。建议改为：

- SaveManager 只保存平台内建状态和通过 `registerStateProvider(id, provider)` 注册的可持久化状态
- provider 使用稳定 ID、snapshot/restore 和版本契约
- SaveManager 不导入、不命名任何游戏业务对象

### P1-6：`engine.js` 中 `nativeContent` 配置没有成为内容包边界

`ng/data/engine.json:5` 声明 `nativeContent`，但 `ng/engine.js` 没有使用该字段加载这些文件。当前仍将内容文件散落在平台配置和引擎入口周围，导致“哪些内容由内容包接管”缺少真实启动契约。

应改成显式内容包入口或 manifest，并验证内容包能够在不修改 `ng/engine.js` 的情况下替换患者、成就、窗口和 Activity。

## P2：通用语言层还需要收紧

### P2-1：`ActivityNodeRegistry` 仍混入若干迁移/叙事语义

`ng/core/ActivityNodeRegistry.js:240-260` 的 `text`、`choice` 等节点可以作为通用 presentation primitive，但 `randomBranch`、`diceCheck`、`segmentBranch` 等迁移兼容节点以及固定的 narrative display 协议需要明确是否是语言本身的通用原语。

原则应是：保留能被任意内容包复用的 flow/value/effect/presentation 原语；不要因为 Cultists 的旧节点名称而新增医学、社交、患者、结局专用节点。

### P2-2：Activity API 仍缺少完整的蓝图可用队列管理面

`ng/engine.js:47-67` 的 API registry 只有 `engine.queue.list`，而 `ng/engine.js:429` 返回的 `activityApi` 不是自动注入蓝图的 API。

建议至少以通用 API 形式暴露并验证：

- `queue.listQueues`
- `queue.append`
- `queue.get`
- `queue.update`
- `queue.remove`
- `queue.complete`
- `queue.cancel`
- `queue.consumeNext`
- `activity.getDefinition`
- `activity.getRunner`
- `activity.pause/resume/cancel`
- 队列和 Activity 生命周期事件订阅/等待

其中 `append`、`run`、`insert` 必须区分“仅加入队列”和“立即执行”，避免管理器 Activity 无法控制调度时机。

### P2-3：`ActivityQueueRegistry` 默认创建 `main` 队列，平台配置仍带有 Cultists 预设队列

`ng/core/ActivityQueueRegistry.js:8-12` 固定创建 `main`，而 `ng/data/engine.json:32-39` 固定配置 `work`、`social`、`managers`、`window-events`、`widget-events`、`desktop-icons`。

`main` 可以是平台默认队列；`work`、`social`、`managers` 则应由内容包声明。窗口事件和桌面图标事件属于平台内部队列，可以保留，但应与内容队列在 registry 中按 owner 分类，避免业务队列名称变成平台契约。

### P2-4：`GameState` 是未接入的第二套游戏状态模型

`ng/core/GameState.js:1-19` 保存 `day`、`phase`、`duty`、`location`、`energy`、`mental`、`physical`、`satiety`；但 `ng/engine.js` 用 `EmptySnapshotStore` 代替真正的 GameState：`ng/engine.js:256-268`。

这既不符合“玩家数值属于公共变量”，也容易形成未来的第三个状态源。应删除未接入的 `GameState`，或把它移到内容包并改为对公共变量/内容 runtime store 的组合视图，而不是引擎内置状态。

## 建议的目标架构

```text
ng/engine.js
  ├─ Desktop/Window kernel
  ├─ Activity definition store / validator / runner / execution service
  ├─ Queue registry + generic queue API
  ├─ SaveManager + registered state providers
  ├─ PublicVariableManager
  ├─ DataStructureManager + DataStore
  ├─ Onboarding runtime/editor
  └─ loadContentPackage(packageManifest)

ng/content/cultists/
  ├─ bootstrap.js
  ├─ achievement manager Activity + achievement runtime provider
  ├─ patient manager Activity + patient runtime provider
  ├─ social-story manager Activity
  ├─ item APIs / item windows / item Activities
  ├─ custom window definitions
  ├─ content queues
  └─ content database definitions and records
```

平台启动顺序应为：

1. 加载平台配置和内容包 manifest
2. 创建七项平台能力
3. 注册内容包的结构、数据库、公共变量定义、窗口、Activity 和 runtime providers
4. `engine:ready`
5. 只将配置中的 default Activity 加入 default queue 并消费
6. 此后只允许正在运行的 Activity 通过通用蓝图 API 调度其他 Activity

## 已执行的验证

本次审计执行了以下真实探针，结果均通过：

- `node ng/tools/audit-legacy-ng.mjs --json`
- `node ng/probes/activity-runtime-probe.mjs`
- `node ng/probes/activity-scheduler-probe.mjs`
- `node ng/probes/public-variable-probe.mjs`
- `node ng/probes/save-manager-probe.mjs`

结果：

- `activity-runtime-probe: all scenarios passed`
- `activity-scheduler probe: ok`
- `public-variable-probe: all scenarios passed`
- `save-manager-probe: all scenarios passed`

这些探针证明现有局部机制可运行，不证明引擎/内容边界合规，也不证明浏览器 UI 行为或完整内容包替换能力。

## 推荐修复顺序

1. 先拆出 `ng/content/` 内容包，移除 `engine.js` 中关键词、物品、成就和疾病/药品拼装逻辑
2. 把成就、物品和业务 runtime state 改成内容包注册的 provider/API
3. 完成时间公共变量的唯一状态源和同步契约
4. 删除或泛化 `ActivityScheduler`，确保核心不再拥有工作/社交/患者语义
5. 将完整队列管理 API注册为蓝图可调用的通用 API，并为 append/run/consume 的语义写探针
6. 清理 `GameState` 与 `VariableStore` 的状态职责，防止玩家状态绕过公共变量系统
7. 最后运行发布构建，扫描发布产物不得包含开发人员模式代码；再做一次内容包替换探针
