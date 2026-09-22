# 上下文新手引导与第 1 天自然教学实现计划

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** 将第 1 天正式游戏流程改造成“自然教学”，并增加一个由事件驱动、可回看、不过度打断玩家的上下文新手引导层。

**Architecture:** 新增轻量 `OnboardingManager` 作为引导状态 owner，监听已有 EventBus 事件并发出引导状态变化；新增 `TutorialOverlay` 作为纯展示层，负责高亮 UI 元素和显示短提示。剧情化的主任/ChatGTP/室友教学内容继续使用 `mainQueue` 与对象式蓝图，但不让蓝图直接锁定 UI、推进教学专用时间或替代引导状态。正式 HIS、关键词、ChatGTP、宿舍和睡觉行为仍走现有业务 owner、日程队列和 `TimeService`。

**Tech Stack:** 原生 HTML/CSS/ES6 modules、现有 `EventBus`、`ScheduleQueue`、`ScheduleRunner`、v16 文件存档；无新依赖、无构建步骤。

---

## 1. 当前上下文与确定的边界

- 游戏首次状态为第 1 天 08:00、白班、工作地点；桌面目前一次性展示 HIS、社交、ChatGTP、关键词笔记本、状态、成就、日历、设置、医院/场景和阶段切换等入口。
- 第 1 天已有适合教学的 HIS 正式病例：对话分支、症状关键词、诊断、药品处方，以及诊断提交后 20 分钟时间推进。
- 第 1 天已有社交日程和 ChatGTP 每日消息，可以承载少量剧情化教学。
- `data/zh-hans/maininit.json` 当前是空的 `{ "entries": [] }`，适合加入少量启动时非阻塞提示，但不应把完整教学流程全部塞入其中。
- `mainQueue` 是非阻塞队列；它适合承载“主任通知/系统消息/角色解释”等剧情化内容，不适合承担“玩家必须按顺序点击某个 DOM 元素”的 UI 流程控制。
- `SaveManager` 当前为 v16，使用 `saveToFile()` 下载二进制存档，并使用 `loadFromFile()` 从用户选择的文件恢复三条队列、游戏状态和窗口等重要状态；引导进度如果需要跨存档文件恢复，必须显式加入存档设计并评估版本变化，不能偷偷依赖临时内存。
- 存档不再写入或读取 URL；启动时始终先显示主菜单，旧 URL 查询串不会自动恢复存档。新游戏只负责清理当前 URL 并进入游戏，文件载入成功后再关闭主菜单。
- 所有教学提示、UI 高亮、打开说明等展示行为不得推进游戏时间；只有真实游戏行为继续使用已有日程实例和 `TimeService`。
- 引导是推荐路径，不是硬锁：玩家可以先打开日历、状态或成就，绕路不会导致教程死锁。

---

## 2. 建议的数据与状态模型

### 2.1 引导里程碑

使用稳定 ID，而不是用当前页面文字判断进度。第一版建议包含：

```text
desktop_seen
his_opened
first_patient_selected
first_dialogue_seen
first_keyword_collected
notebook_opened
chatgtp_opened
first_query_completed
first_diagnosis_submitted
workday_completed
dorm_seen
first_social_interaction
sleep_explained
```

每个里程碑只表达“玩家已经发生过某个行为”，不表达剧情结局，也不写入 `global_variables.json`。

### 2.2 引导状态

建议 `OnboardingManager` 持有：

- `enabled`：是否启用辅助引导；
- `mode`：`assist` / `minimal`，第一版可以只实现辅助模式；
- `milestones: Set<string>`；
- `activeHintId`：当前正在显示的提示；
- `dismissedHintIds`：玩家选择“不再提示”的提示；
- `currentRecommendedGoal`：当前推荐目标；
- `started` 或 `isNewGame` 的初始化上下文。

“是否首次玩过”应与“本次存档是否看过某个提示”区分。第一版可先按每个存档保存里程碑；跨存档的“已经看过基础教程”属于后续玩家偏好，不要与单局剧情状态混用。

### 2.3 提示定义

提示定义应数据驱动，但第一版可以放在 `js/core/OnboardingManager.js` 的小型静态定义中，避免一开始新增另一套 JSON 管理体系。稳定结构建议：

```js
{
  id: "his-first-open",
  trigger: "onboarding:milestone:his_opened",
  target: { appId: "his", selector: ".his-patient-btn:first-of-type" },
  title: "第一次问诊",
  text: "点击病人查看对话，收集症状，最后提交诊断与处方。",
  once: true,
  allowDismiss: true
}
```

后续如果提示数量明显增加，再迁移到 `data/<lang>/onboarding.json`；不要为了第一版过早增加内容文件和编辑器。

---

## 3. 运行时分层

### 3.1 `OnboardingManager`

**建议文件：** `js/core/OnboardingManager.js`

职责：

1. 提供 `startNewGame()`、`resetForNewGame()`、`markMilestone(id)`、`hasMilestone(id)`、`dismissHint(id)`、`snapshot()`、`restore()`。
2. 监听已有事件并将业务事件映射为里程碑，例如：
   - 桌面启动完成 → `desktop_seen`；
   - HIS 窗口打开或首次成功渲染 → `his_opened`；
   - 第一次患者选择 → `first_patient_selected`；
   - `keyword:collected` → `first_keyword_collected`；
   - 关键词笔记本打开 → `notebook_opened`；
   - ChatGTP 窗口打开 → `chatgtp_opened`；
   - ChatGTP 查询完成 → `first_query_completed`；
   - 医疗提交完成 → `first_diagnosis_submitted`；
   - `daynight:changed` 进入宿舍 → `dorm_seen`；
   - 社交日程完成或首次室友互动 → `first_social_interaction`；
   - 睡觉/跨日结算 → `sleep_explained`。
3. 对重复事件幂等处理；已完成的里程碑再次发生时不得重复触发同一提示。
4. 只发出引导事件，例如 `onboarding:changed`、`onboarding:hint_requested`，不直接操作业务 manager，不直接推进时间。
5. 事件订阅必须有清理路径，避免重载或测试时重复注册。

注意：如果某个现有 App 没有明确的“打开事件”，优先在共享窗口创建入口或 App 成功完成初始化处增加语义明确的事件，而不是让引导系统观察 DOM。

### 3.2 `TutorialOverlay`

**建议文件：** `js/desktop/TutorialOverlay.js`，HTML 容器可新增到 `index.html`。

职责：

- 根据 `target` 查找并高亮目标；目标不可见时显示居中的非指向性提示，不阻塞玩家；
- 显示标题、短说明、“知道了”和可选的“以后不再提示”；
- 支持窗口重绘、窗口移动、App 异步加载后重新定位；
- 允许玩家关闭提示后继续自由操作；
- 提示关闭不代表里程碑完成，里程碑只由真实游戏事件确认；
- 不调用 `TimeService`、不写 `GameState`、不修改队列；
- 统一处理键盘 Escape、Tab、Enter 等基础可访问性行为。

不建议第一版使用全屏强遮罩。可以使用小箭头、边框高亮、轻量气泡；只有第一次启动桌面时可以使用一次短暂的中央欢迎提示。

### 3.3 `TodayGoalPanel`（可选的第一版后半段）

先不要做独立任务系统。可把当前推荐目标作为 `TutorialOverlay` 的非阻塞提示实现。如果验证后需要持续可见，再新增桌面/任务栏中的小型“今日目标”区域。

推荐目标来源应是里程碑状态的纯派生结果，不单独维护第二份任务进度：

```text
未打开 HIS       → 建议打开 HIS
未收集关键词     → 建议在对话中点击高亮关键词
未打开笔记本     → 建议查看关键词笔记本
未完成查询       → 建议用一个关键词查询 ChatGTP
未完成首例问诊   → 建议提交诊断与处方
未进入宿舍       → 建议下班后回宿舍
未睡觉           → 建议结束今天并睡觉
```

---

## 4. 第 1 天推荐教学流程

### 4.1 开始新游戏

- `MainMenu` 的新游戏动作继续只负责清理可能残留的 URL 查询串并进入游戏；载入动作使用文件选择器，不再要求粘贴存档字符串。
- `main.js` 在新游戏路径初始化 `OnboardingManager`，显示一次欢迎提示：
  > 第 1 天 · 08:00。建议先打开桌面上的 HIS 医疗系统。
- HIS 图标高亮，但不隐藏其他图标。
- 如果玩家直接打开别的 App，不报错、不重置引导；回到桌面后仍显示 HIS 推荐。

### 4.2 第一次打开 HIS

- HIS 成功挂载后记录 `his_opened`。
- 高亮第一个病人或患者列表区域；如果 HIS 尚未完成异步加载，等它发出成功渲染事件，不要凭空高亮空容器。
- 提示：
  > 点击病人查看对话，收集症状，最后提交诊断与处方。

### 4.3 第一次对话与关键词

- 第一次出现可收集关键词时提示一次：
  > 对话中的高亮词汇可以点击收集，之后会出现在关键词笔记本中。
- 现有关键词收集行为保持不变；提示不替代 `KeywordManager`。
- 第一次收集后，如果玩家尚未打开笔记本，给出“可选”提示，而不是强制打开。

### 4.4 第一次打开关键词笔记本

- 记录 `notebook_opened`。
- 提示：
  > 笔记本会保存你收集到的关键词。双击关键词，可以直接交给 ChatGTP 查询。
- 这里应继续使用现有 Notebook → ChatGTP 预选关键词路径。

### 4.5 第一次打开 ChatGTP

- 记录 `chatgtp_opened`。
- 提示：
  > ChatGTP 可以根据 1～2 个关键词进行分析。查询会消耗时间，也会影响它自己的 SAN。
- 不要在提示层复制完整的 ChatGTP 规则；详细内容留给 App 自身状态栏或实习手册。

### 4.6 第一次诊断提交

- 提交前可在处方区域进行一次轻量高亮：
  > 提交后会结算本次问诊，并推进 20 分钟。提交前请确认诊断和处方。
- 该提示不得拦截提交，也不得提前修改患者状态。
- 只有 `medicalSubmission` 成功完成后才记录 `first_diagnosis_submitted`。
- 结果继续由现有 HIS 结算逻辑展示；引导系统不重复计算奖金或提成。

### 4.7 白班结束与宿舍

- 白班内容完成或玩家第一次合法下班时，提示：
  > 白班结束后，可以进入宿舍进行社交、调查和使用电脑。
- 第一次进入宿舍时高亮室友区域、电脑和床，但建议一次只提示一个目标，避免三个箭头同时出现。
- 宿舍提示：
  > 夜间可以和室友交流、调查物品、使用电脑。准备结束今天时，可以点击床铺睡觉。

### 4.8 第一次睡觉

- 在第一次执行合法睡觉后显示一次：
  > 睡觉会进入下一天，并结算休息、收入和其他跨日效果。
- 此提示不能代替 `TimeService` 的实际日结逻辑。

---

## 5. 蓝图与 `mainQueue` 的使用范围

### 5.1 适合放入 `mainQueue` 的内容

第一版可以在 `maininit.json` 加入一个简短、非阻塞的入职消息，或者在 `mainpub.json` 添加可插入的公共提示，例如：

- 主任的第一天通知；
- ChatGTP 第一次打开时的角色化自我介绍；
- 第一次完成诊断后的一条系统/主任反馈；
- 第一次进入宿舍时阿杰的生活提示。

这些蓝图只负责文本、角色表现和已有语义副作用。它们的完成不应被误认为玩家已经掌握某个系统。

### 5.2 不适合放入蓝图的内容

不要为以下行为新建大量教学蓝图节点：

- 高亮某个 DOM 元素；
- 记录提示是否已读；
- 让玩家必须点击某个图标；
- 控制提示窗口位置；
- 因玩家关闭提示而推进时间；
- 用教学节点替代真实 HIS、Notebook、ChatGTP 或睡觉操作。

### 5.3 如果需要“剧情化教程日程”

可建立一个独立的 `tutorial:intro` 主队列实例，但必须满足：

- 只负责短文本和提示性反馈；
- 使用 `mainQueue` 的现有持久化和 runner；
- 不与 `workQueue` / `socialQueue` 的阻塞批次混用；
- 不占用白班或夜班的完成条件；
- 不在 App 中直接调用 `advanceBy()`；
- 玩家跳过或绕路时不会使其处于无法解析的等待状态；
- 不把教程实例的完成状态当成正式剧情条件，除非另有明确设计。

---

## 6. 建议的代码修改范围

### 第一阶段：引导基础设施

- 创建：`js/core/OnboardingManager.js`
- 创建：`js/desktop/TutorialOverlay.js`
- 修改：`index.html`，增加教程层容器；所有新增 HTML/CSS/JS 若只用于开发工具以外的玩家功能，不放入 DEV 标记。
- 修改：`js/main.js`，初始化 onboarding、挂载 overlay，并将新游戏/读档路径与引导状态关联。
- 修改：`js/core/EventBus.js` 仅在确实需要统一事件命名时补充注释，不改变已有语义。

### 第二阶段：接入业务事件

- 修改：`js/apps/HISApp.js`，在成功打开、首次选中患者、医疗提交成功处发出明确事件或调用 onboarding facade；保持业务状态由原有 owner 修改。
- 修改：`js/apps/NotebookApp.js`，发出打开笔记本事件；不改变关键词集合和删除行为。
- 修改：`js/apps/ChatGTPApp.js`，发出打开窗口和查询完成事件；不改变 SAN、查询队列和答案逻辑。
- 修改：`js/desktop/DormMode.js`，发出进入宿舍、首次互动和睡觉相关事件；不复制阶段切换逻辑。
- 如需要统一 App 打开事件，优先修改 `js/core/WindowManager.js` 或共享窗口创建入口，而不是让每个引导点通过 DOM 猜测。

### 第三阶段：内容与视觉

- 修改：`data/zh-hans/maininit.json`，只加入短的剧情化启动内容，保持 `{ entries: [] }` 或合法对象式蓝图结构。
- 修改：`data/strings.zh_hans.json`，加入 overlay 按钮、通用提示和辅助模式文本；剧情内容仍放语言数据目录。
- 修改：`css/` 中合适的全局/桌面样式文件，新增高亮、气泡、关闭按钮样式；避免把引导样式散落到各 App。
- 可选创建：`data/<lang>/onboarding.json`，仅在提示定义已经足够多且需要内容编辑器时进行。

### 第四阶段：存档

- 修改：`js/core/SaveManager.js`，如果确定要在同一文件存档中保存里程碑/当前提示，则加入 `onboarding` payload，并提升格式版本或设计明确的兼容策略；继续使用 `saveToFile()` / `loadFromFile()`，不得恢复 URL 持久化路径。
- 不保存临时 DOM 信息，例如当前高亮矩形、打开的提示位置、鼠标焦点；加载存档后根据里程碑和当前状态重新计算。
- 读档后先恢复引导状态，再让界面根据当前实际状态重新渲染，避免旧提示指向不存在的患者或已完成的 App。

---

## 7. 确定性验证方案

项目没有测试框架，因此增加一个可重复执行的 Node 探针，建议放在 `scripts/probe-onboarding.mjs` 或现有 probe 目录（实施前先检查仓库是否已有探针目录）。探针至少覆盖：

1. 新游戏初始化为无里程碑，首个推荐目标为打开 HIS。
2. 重复 `markMilestone("his_opened")` 不产生重复状态或重复提示。
3. `keyword:collected` 只完成关键词里程碑，不自动把关键词加入查询选择集，不推进时间。
4. Notebook 打开后推荐目标转为 ChatGTP/关键词查询。
5. 医疗提交失败或取消不完成 `first_diagnosis_submitted`。
6. 医疗提交成功后只完成一次首例提交里程碑。
7. overlay 关闭不会改变游戏状态、时间或队列长度。
8. 目标元素缺失时提示降级为非指向性提示，不抛异常、不阻塞游戏。
9. snapshot/restore 保留里程碑和辅助模式，但不保存 DOM 引用或过期 selector 状态。
10. 读档到白班、宿舍、已完成首例等不同状态时，推荐目标由当前里程碑和实际状态共同确定。
11. 引导初始化不会重复订阅 EventBus；销毁/重载后监听器数量恢复。
12. 若加入 `maininit.json` 内容，验证 JSON、entry ID 唯一、蓝图可达、不会产生未声明的时间或状态副作用。

实现阶段必须执行：

```bash
node --check js/core/OnboardingManager.js
node --check js/desktop/TutorialOverlay.js
node --check js/main.js
node --check js/apps/HISApp.js
node --check js/apps/NotebookApp.js
node --check js/apps/ChatGTPApp.js
node --check js/desktop/DormMode.js
python3 -m json.tool data/zh-hans/maininit.json >/dev/null
python3 -m json.tool data/zh-hans/strings.zh_hans.json >/dev/null
node scripts/probe-onboarding.mjs

git diff --check
```

如果后续用户明确要求浏览器 UI 验证，再实际验证：新游戏、绕过 HIS 打开其他 App、关键词收集、首次 ChatGTP 查询、诊断提交、进入宿舍、睡觉，以及下载存档后刷新页面并通过文件选择器恢复。未明确要求前，以静态检查和确定性探针为主。

---

## 8. 风险与取舍

### 风险一：提示过多，反而打断游戏

控制策略：每个机制只在第一次关键时刻提示一次；提示文字控制在 1～2 句；允许关闭；不使用全屏锁定。

### 风险二：事件命名和实际 UI 生命周期不一致

控制策略：事件必须由业务动作成功点发出；“窗口创建”不等于“App 内容加载成功”；对于异步 App 使用成功渲染事件。

### 风险三：存档恢复后出现错误高亮

控制策略：只保存里程碑，不保存 DOM 引用和坐标；加载后重新检查当前游戏状态、窗口是否存在、目标是否可见。

### 风险四：引导状态变成第二套游戏状态

控制策略：引导只能提出提示和推荐目标，不拥有时间、SAN、好感度、病人提交、关键词集合或队列执行状态；所有正式结果仍由现有 owner 决定。

### 风险五：使用蓝图后教程被队列卡住

控制策略：剧情化蓝图只做短消息；不要让它等待 UI 点击；如果以后确实需要 `waitUntil`，必须明确等待的权威状态和保存/恢复行为，并增加阻塞节点探针。

### 风险六：过早把提示写成新 JSON schema

控制策略：第一版先用集中定义验证交互和提示节奏；提示数量稳定后再迁移到 `onboarding.json`，同时补齐多语言、校验和编辑器支持。

---

## 9. 推荐实施顺序

1. 先只实现 `OnboardingManager` 和里程碑，不显示任何提示，验证事件映射正确。
2. 加入 `TutorialOverlay`，只实现桌面首次提示和 HIS 首次打开提示。
3. 接入关键词、Notebook、ChatGTP、诊断提交和宿舍/睡觉提示。
4. 将第 1 天提示顺序调整到“推荐路径”，测试玩家绕路时不会卡死。
5. 加入一条可选的 `maininit` 主任通知，确认剧情消息与 UI 引导职责没有重叠。
6. 决定是否保存 onboarding 状态；如果保存，先完成 snapshot/restore 探针，再改 SaveManager 版本。
7. 根据实际体验决定是否增加持续显示的“今日目标”面板或可回看的“实习手册”。
8. 完成 JSON、语法、探针、差异和发布边界检查；不要在第一版同时重构 HIS、ChatGTP 或队列架构。

---

## 10. 第一版验收标准

- 新玩家进入第 1 天时知道推荐先打开 HIS，但桌面仍然可自由探索。
- 玩家第一次接触 HIS、关键词、笔记本、ChatGTP、诊断提交、宿舍和睡觉时，能在对应上下文获得短提示。
- 提示本身不会消耗 20 分钟，不会改变 SAN、好感度、收入、库存或队列。
- 正式游戏行为仍由现有蓝图、队列、`TimeService` 和业务 manager 执行。
- 玩家关闭提示、跳过某个 App 或先探索其他内容时，引导不会死锁或错误完成里程碑。
- 刷新/读档后不会出现指向旧 DOM 的提示；需要保存的引导进度有明确版本和确定性恢复行为。
- 第 1 天的自然教学不需要单独制作一套完整教学病例即可工作。
