# 旧引擎 UI 迁移审计报告

- 审计对象：当前引擎 `W:\_\cultists`
- 对照对象：旧引擎只读副本 `W:\_\cultists1`
- 审计范围：桌面外壳、任务栏/开始菜单、窗口框架、应用窗口、数据驱动 Widget、CSS 视觉契约和可见入口
- 审计方式：源码/JSON/CSS 对照、HTTP 启动检查、静态结构统计
- 审计日期：2026-09-12

## 结论摘要

当前引擎已经完成了“Win95 外壳 + 多数应用窗口”的数据驱动迁移，但尚未达到旧引擎的 UI 实际等价。当前版本的主要差异不是颜色主题，而是：

1. 桌面入口集合缩减，旧引擎可见的设置、地点和阶段切换入口没有全部迁移到当前 `data/desktop-icons.json`。
2. `social`/夜聊窗口从旧版“双栏联系人 + 聊天区”变成了单个通用 `dialogue` Widget；这是结构和操作路径差异，不只是样式差异。
3. 当前窗口定义增加了 `clue-wall`、`locations`、`off-duty`、`off-duty-blocked`、`item-inspection`、`location-scene` 等新数据窗口，但旧版对应功能主要由 `LocationScene`、`DormMode`、`CustomWindowApp` 等代码入口承载，迁移后的入口和可见路径尚未一一对齐。
4. 当前窗口框架保留了旧版标题栏、拖拽、缩放、最小化、最大化和系统菜单，但若干尺寸、间距、阴影和菜单定位值不同。
5. HIS、日历、ChatGTP、笔记本、状态、成就、海龟汤等窗口已有数据定义；静态结构可以证明“有对应定义”，但不能证明浏览器中的视觉和交互已经完全一致。本次浏览器自动化被本地地址访问策略拦截，因此未把 UI 交互标记为通过。

## 1. 表面规模与入口差异

### 1.1 旧版应用注册表

旧引擎 `W:\_\cultists1\js\main.js:116-138` 的正常运行入口包括：

| 入口 | 旧版 ID | 说明 |
| --- | --- | --- |
| HIS | `his` | 医疗系统 |
| 自定义 HIS 原型 | `his_custom` | 开发/原型窗口 |
| 夜聊 Messenger | `social` | 联系人 + 聊天 |
| ChatGTP | `chatgtp` | 问答窗口 |
| 关键词笔记本 | `notebook` | 关键词/法术 |
| 状态与属性 | `status` | 状态、物品、NPC、存档 |
| 成就 | `achievements` | 成就列表 |
| 日历 | `calendar` | 日历 |
| 设置 | `settings` | BGM、排序、确认、语言 |
| 医院 | `hospital` | 地点场景入口 |
| 火锅店 | `restaurant` | 地点场景入口 |
| 海边 | `seaside` | 地点场景入口 |
| 阶段切换 | `phase-toggle` | 下班/去上班/睡觉动态入口 |

开发模式另加 `developer-mode`。

### 1.2 当前桌面入口

当前 `data/desktop-icons.json` 只有 9 条记录：

`his`、`chatgtp`、`social → dialogue`、`notebook`、`status`、`achievements`、`calendar`、`locations`、`off-duty`。

实际差异：

- 当前桌面没有旧版独立 `settings` 入口，也没有 `settings.json` 窗口定义。
- 当前桌面没有旧版 `hospital`、`restaurant`、`seaside` 三个地点入口；它们被合并为 `locations` 窗口，是否能从该窗口继续完成旧版三地点路径，需要真实操作确认。
- 当前桌面没有 `turtle-soup` 入口，虽然存在 `data/windows/turtle-soup.json`。
- 当前桌面没有 `social-media` 入口，虽然存在 `data/windows/social-media.json`。
- 旧版的 `his_custom` 原型入口不再作为独立桌面图标，当前 `his-custom` 图标直接打开 `his`。
- 当前 `off-duty` 是显式 Activity 入口；旧版是动态 `phase-toggle`，标签和图标随地点/时间变化。当前是否完全覆盖“去上班/下班/睡觉”三个动态状态，不能仅凭图标 JSON 判定。
- 当前 `social` 图标的标签仍是“夜聊 Messenger”，但打开的是 `dialogue`，不是一个名为 `social` 的窗口定义。

## 2. 窗口尺寸和框架差异

### 2.1 已有同 ID 窗口的尺寸

| 窗口 | 旧版 | 当前 | 结论 |
| --- | ---: | ---: | --- |
| HIS | 640×460 | 640×460 | 尺寸一致 |
| ChatGTP | 500×540 | 500×540 | 尺寸一致 |
| 笔记本 | 420×500 | 420×500 | 尺寸一致 |
| 状态 | 400×440 | 440×500 | 当前更宽 40、高 60 |
| 成就 | 440×480 | 440×480 | 尺寸一致 |
| 日历 | 460×500 | 460×500 | 尺寸一致 |
| 海龟汤 | 560×560 | 560×560 | 尺寸一致 |
| 社交 | 560×420 | 当前 `dialogue` 520×320 | 当前窗口更窄 40、更矮 100，且结构不同 |
| 社交媒体 | 旧版无独立同名应用入口 | 520×360 | 当前新增/拆分窗口 |

旧版尺寸来自 `W:\_\cultists1\js\apps\*.js` 的 `createWindow()` 参数；当前尺寸来自 `data/windows/*.json`。

### 2.2 外壳 CSS 的可见差异

对照文件：旧版 `W:\_\cultists1\css\win95.css`，当前 `style.css` 与 `core/desktopWindowFrame.js`。

| 项目 | 旧版 | 当前 | UI 影响 |
| --- | --- | --- | --- |
| 窗口 CSS 类 | `.win95-window`、`.win95-titlebar`、`.win95-window-body` | `.ng-window`、`.ng-titlebar`、`.ng-body` | DOM 类名改变；当前通过新类复刻视觉 |
| 窗口最小尺寸 | 260×160 | 220×140 | 当前窗口可缩得更小 |
| 系统菜单顶部 | `top: 24px` | `top: 20px` | 菜单更贴近标题栏 |
| 系统菜单最小宽度 | 130px | 110px | 菜单更窄 |
| 通用 `bevel-out` 内阴影 | 右下使用 `var(--w95-gray-dark)` | 右下使用 `var(--w95-gray-light)` | 未覆盖到专用控件时，边缘明暗不同 |
| 面板内边距 | `.panel-inset` 为 `6px` | 当前基础 `.panel-inset` 为 `4px 6px` | 当前垂直内容空间少 4px |
| 标题栏控制按钮 | 16×14 | 16×14 | 尺寸一致；当前显式修复了按下态边框/阴影 |
| body | 白底、滚动、上边距 2px、padding 6px | 同样结构 | 基础窗口 body 基本一致 |
| 字体 | Sarasa Fixed SC，旧版路径 `../data/assets/...` | Sarasa Fixed SC，当前路径 `data/assets/...` | 字体资源和视觉目标一致，路径随目录改变 |

当前 `WindowFrame` 还增加了基于 `WindowManager` 的实例级焦点、拖拽、缩放、最大化和系统菜单；这属于实现方式变化，不代表每个应用的行为已经等价。

## 3. 应用窗口的实际结构差异

### 3.1 HIS：已迁移，结构目标接近但不是 DOM 等价

旧版 `W:\_\cultists1\js\apps\HISApp.js:47-59` 直接生成：

- 左侧 `.his-patient-list`
- 右侧 `.his-main`
- 医疗事件区
- 对话区
- 诊断区
- 处方区

当前 `data/windows/his.json` 使用 `container/list/select/button` 等 NGL Widget，并由 `WidgetLayoutRenderer` 渲染；当前 `style.css:1073-1197` 保留了 `.his-layout`、`.his-patient-list`、`.his-main`、`.his-dialogue`、`.his-diagnosis`、`.his-prescription` 等语义类。

已确认的迁移保持项：

- 640×460、可缩放、单实例保持。
- 左侧病人列表宽度 140px 保持。
- 诊断、处方和患者选择使用数据绑定/Activity 事件，而不是旧版窗口函数直接提交。
- 处方动态行和提交按钮已有 NGL 结构。

仍需浏览器确认的项目：

- 初始空状态、患者选择后对话高度、诊断下拉选项和处方行是否与旧版实际折叠/滚动一致。
- 患者提交后的禁用/灰显效果是否与旧版 `.his-patient-submitted` 一致。
- 长对话、长患者列表和窗口缩放时的滚动边界。

### 3.2 夜聊 Social：当前存在明确的 UI 回退

旧版 `W:\_\cultists1\js/apps/SocialApp.js:35-42` 创建双栏：

```text
.social-layout
├── .social-contact-list.panel-inset
└── .social-chat.panel-inset
```

旧版还提供：

- 按日期/时间分组的联系人列表
- 已完成、离线、睡眠、低 SAN 等状态图标
- 联系人按钮禁用逻辑
- 聊天气泡 `.chat-bubble.bubble-npc` / `.bubble-me`
- 联系人选择后保持聊天区上下文

当前已将 `data/windows/dialogue.json` 改为 `620×360` 双栏结构：左侧联系人列表由 `socialContacts` runtime collection 提供，点击联系人会把稳定的 Activity 实例 ID 写入 `social:selectedInstance`；右侧仍由通用 DialogueWidget 接收 `dorm-bottom` 对话事件。`RuntimeCollectionRegistry` 已提供通用 `activityQueueId`/`projectPayload` 投影，并在队列变化时触发窗口刷新。

当前状态为“结构与队列数据已迁移，聊天切换行为已支持只读回放”：左栏已经不再是静态联系人占位，并已按队列的 `receivedDay` 分组、显示时间与状态；点击联系人会回放该 Activity 实例已保存的 transcript，不会重新执行蓝图。仍缺少离线/睡眠/低 SAN 状态图标和禁用逻辑，也尚未把未完成实例的交互式继续执行上下文完整迁移。不能据此宣称 SocialApp 完全等价。

### 3.3 日历：结构保持，当前实现已声明式化

旧版 `CalendarApp.js` 生成摘要、图例、未解锁提示和 7 天 + 第 8–31 天锁定格子。当前 `data/windows/calendar.json` 保留同样的摘要、图例、未解锁文字和 `calendar-grid` 列表，数据由 `calendarDays` runtime collection 提供。

已确认的静态差异：

- 旧版图例每项有 `i` 色块元素；当前图例是带语义类名的 label Widget。颜色是否实际一致取决于当前 CSS 状态类渲染。
- 当前列表由通用 `list` renderer 输出，旧版由 `div.calendar-day` 循环输出；需要浏览器确认 `statusClass` 是否真正附着到每个格子。

### 3.4 笔记本：功能面扩大，视觉结构不同

旧版 NotebookApp 使用两个页签“关键词/法术”，关键词列表是 `.notebook-item`，带来源、删除按钮，双击打开 ChatGTP；法术以绿色卡片显示并有施放按钮。

当前 `data/windows/notebook.json` 使用 `list`、`collection.set`、`openWindow`、`runActivity` 和 `setVariable`。当前 CSS 主要使用 `.ng-notebook-view`、`.ng-notebook-item`，其列表行 padding 为 `4px 0`；旧版 `apps.css` 的列表项包含更明显的 flex 间距和删除按钮布局。

结论：数据/事件迁移方向正确，但不能按“有 notebook.json”判定外观等价；页签选中态、删除按钮、法术卡片和双击路径需要浏览器验证。

### 3.5 状态：尺寸和数据范围发生变化

旧版 StatusApp 的窗口为 400×440，四个页签：状态、物品、NPC、保存。当前状态窗口为 440×500，并使用声明式 `saveLoad`、`select`、`list` 和 Activity 节点。

当前更大的窗口可能是为了容纳迁移后的内容，但这已经是可见布局变化。旧版的“状态页”还显示精力、精神/理智、体力、饱腹、时间、技能等多行信息；当前定义和数据库绑定需要逐项核对，不能只比较窗口标题。

### 3.6 ChatGTP、成就、海龟汤：定义存在，迁移层次增加

这三个窗口当前均有对应 JSON 定义，且树中包含列表、选择、文本输入、Activity 分支或变量写入等节点。旧版则分别由 `ChatGTPApp.js`、`AchievementsApp.js`、`TurtleSoupApp.js` 直接构建 DOM。

当前的主要 UI 风险是通用 renderer 的默认行为：

- `list` 的项模板、meta、状态类是否完全复刻旧版的自定义行结构；
- `select` 的 option label/value 是否与旧版字符串和禁用条件一致；
- `textarea`、fieldset/details 和结果区域的 padding/overflow 是否一致；
- Activity 事件完成后窗口是否保留旧版的即时反馈，而不是只刷新整个 root。

### 3.7 设置、地点和模式窗口：入口迁移不完整

旧版 `SettingsApp.js` 明确包含 BGM 滑块、笔记本排序下拉、阶段确认复选框和语言下拉，窗口为 360×300 且不可缩放。当前已迁移为 `data/windows/settings.json`，并通过 `settings` 桌面图标接入；四项控件均使用 NGL 属性绑定和事件流程，语言使用 core 的 `getLanguage` / `setLanguage` 节点。仍需浏览器实际操作确认尺寸、控件反馈和持久化恢复。

旧版 `LocationScene.js`、`DormMode.js`、`MainMenu.js`、`EndingScreen.js`、`NotificationBanner.js`、`TutorialOverlay.js` 是可见 UI 的重要组成部分。当前已增强 `data/windows/location-scene.json`：从 canonical 位置数据库读取地点名称、背景和 `subLocations`，以通用 list Widget 显示可调查区域；仍缺少真实点击区域交互和浏览器证据。主菜单、结局、通知、宿舍场景仍应列为“运行时外壳/模式迁移”，直到有真实入口和浏览器证据。

## 4. 当前与旧版的迁移映射

| 旧版可见面 | 当前映射 | 状态 | 迁移建议 |
| --- | --- | --- | --- |
| Win95 桌面 | `DesktopShell` + `desktopDesktopIcon` | 基本完成 | 用浏览器核对图标位置、双击、开始菜单和任务栏 |
| 窗口框架 | `WindowFrame` + `WindowManager` | 基本完成但有尺寸差异 | 决定是否保留 220×140 新最小值；若目标是像素/行为等价，应回到旧值 |
| HIS | `data/windows/his.json` | 高度迁移，需交互核对 | 优先做长列表、诊断、处方和提交回归 |
| Social | `data/windows/dialogue.json` | 不等价 | 恢复联系人列表 + 聊天双栏，或明确产品决策改为通用对话窗口 |
| ChatGTP | `data/windows/chatgtp.json` | 有定义，需交互核对 | 对照旧版输入、查询、关键词选择、历史和 SAN 状态 |
| Notebook | `data/windows/notebook.json` | 有定义，视觉可能不同 | 对照页签、列表、删除、双击查询和法术卡片 |
| Status | `data/windows/status.json` | 有定义，尺寸不同 | 对照四页签、状态行、物品/NPC/存档区域 |
| Achievements | `data/windows/achievements.json` | 有定义 | 对照锁定/解锁卡片和滚动 |
| Calendar | `data/windows/calendar.json` | 结构接近 | 对照色块、当前日、夜班、未解锁天数 |
| Turtle Soup | `data/windows/turtle-soup.json` | 有定义但无桌面入口 | 补入口并验证完整答题路径 |
| Social Media | `data/windows/social-media.json` | 当前新增/拆分 | 与旧版是否存在的实际产品路径对齐 |
| Settings | `data/windows/settings.json` + `settings` desktop icon | 结构已迁移，需交互核对 | 验证四项控件、语言切换和存档恢复 |
| 地点三入口 | `locations.json` + `location-scene.json` | 入口和场景列表已迁移，需交互核对 | 验证三地点背景、子区域和点击交互 |
| 下班/睡觉 | `off-duty*.json` + Activity | 重构为数据 Activity | 验证三种状态、阻塞提示、确认和恢复 |
| 主菜单/结局/通知/教程 | 部分 core/Activity/overlay | 未证明等价 | 分别建立入口矩阵和浏览器回归证据 |

## 5. 优先级与验收标准

### P0：阻断“UI 已迁移”结论

1. 恢复 Social 的联系人列表、状态标识、联系人选择和双栏聊天结构，或记录产品决策明确放弃旧版结构。
2. 在浏览器中核对 Settings 的可见入口和四项设置行为。
3. 证明地点入口和阶段切换在当前桌面可达，并覆盖旧版三地点及“去上班/下班/睡觉”状态。

### P1：窗口视觉回归

1. 统一窗口最小尺寸、系统菜单定位、panel padding 和 bevel 阴影，或者在报告中保留为有意设计差异。
2. 对每个同尺寸窗口核对标题、图标、body 滚动、缩放、最小化、最大化、关闭和任务栏状态。
3. 对 HIS、Notebook、Status、Calendar、ChatGTP、Achievements、Turtle Soup 做 DOM 结构和截图对照。

### P2：迁移完整性

1. 为 `turtle-soup`、`social-media`、`settings` 和 `locations` 建立桌面/开始菜单入口矩阵。
2. 为主菜单、宿舍、地点、通知、结局、教程建立旧版入口到当前 Activity/Widget 的映射表。
3. 将每个“结构存在”结论和“真实可操作”结论分开记录。

## 6. 验证记录

### 已执行

- 当前引擎静态服务器：`http://127.0.0.1:8123/index.html`，HTTP 200。
- 旧引擎静态服务器：`http://127.0.0.1:8124/index.html`，HTTP 200。
- 已读取并对照旧版 `js/apps`、`js/desktop`、`css/win95.css`、`css/apps.css` 与当前 `core`、`data/windows`、`data/desktop-icons.json`、`style.css`。
- 已执行当前工作区 `git diff --check`，通过；审计开始时工作区已有用户改动，本报告没有覆盖这些改动。

### 未通过/未完成

- 浏览器自动化访问 `127.0.0.1`/`localhost` 被当前浏览器工具的私有地址策略拦截，未能取得两套运行时的 DOM、截图或真实点击结果。
- 因此本报告没有声称“视觉完全一致”“交互完全一致”或“迁移完成”。上述“已迁移/结构接近”仅表示源代码和数据定义存在对应结构。

## 7. 审计依据

- 旧版应用：`W:\_\cultists1\js\apps\*.js`
- 旧版桌面注册：`W:\_\cultists1\js\main.js:116-138`
- 旧版窗口/外壳：`W:\_\cultists1\js\desktop\Desktop.js`、`Taskbar.js`、`W:\_\cultists1\css\win95.css`
- 旧版应用样式：`W:\_\cultists1\css\apps.css`
- 当前窗口定义：`data/windows/*.json`
- 当前桌面入口：`data/desktop-icons.json`
- 当前窗口运行时：`core/desktopWindowFrame.js`、`core/desktopDesktopShell.js`、`core/WidgetLayoutRenderer.js`
- 当前样式：`style.css`
