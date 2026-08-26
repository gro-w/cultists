# Cultists OS 95

一个仿 Windows 95 风格的可拓展 Web 游戏引擎，服务于以“关键词收集与解谜/交互”为核心机制的桌面模拟器游戏。

## 运行方式

由于引擎通过 `fetch` 异步加载 `data/` 目录下的 JSON 配置，浏览器的同源策略要求项目必须通过 HTTP(S) 服务器访问（不能直接双击打开 `index.html`）。

```bash
# 在项目根目录下启动一个静态服务器，例如：
python3 -m http.server 8000
# 然后在浏览器中访问
http://localhost:8000/
```

## 目录结构

```
index.html                  # 入口页面：桌面 / 任务栏 / 开始菜单骨架
css/
  win95.css                 # Win95 基础样式库（窗口、按钮、任务栏、图标、立体边框）
  apps.css                  # 各应用内部界面样式
js/
  core/
    EventBus.js             # 全局发布/订阅事件总线（单例）
    Window.js                # 单个窗口的 DOM/拖拽/缩放/最小化/关闭逻辑
    WindowManager.js         # 窗口系统单例：创建、聚焦、层叠、单实例管理
    DataLoader.js            # 数据加载器单例：异步读取并缓存 data/ 下的 JSON
    KeywordManager.js        # 关键词全局总线单例：高亮渲染、点击收集、笔记本同步
    GameState.js             # 主角状态单例：精力/精神/体力/饱腹/天数/昼夜阶段
    DayNightSystem.js        # 昼夜循环管理：阶段切换（应用始终可用，内容随阶段变化）
    DialogueProgress.js      # 记录 HIS/社交软件当前对话到了哪个 NPC/哪个节点（供恢复与存档使用）
    ItemManager.js           # 物品/背包单例：物品定义加载、持有数量、调查、使用效果结算
    SaveManager.js           # 存档单例：构建规范索引表、状态压缩编码/解码、读写 URL search
    SettingsManager.js       # 设置单例：BGM 音量、笔记本排序方式、下班/睡觉确认开关（localStorage 持久化）
    AudioManager.js          # BGM 播放单例：音量实时跟随 SettingsManager
    ConfirmDialog.js         # Win95 风格确认/取消模态框（替代 window.confirm）
    Pinyin.js                # 关键词首字拼音首字母查表工具（供笔记本"按拼音"分组使用）
  desktop/
    Desktop.js               # 桌面图标渲染与启动（所有应用常驻桌面）
    Taskbar.js                # 任务栏（窗口标签、时钟、开始菜单、昼夜指示）
    NotificationBanner.js    # 阶段切换提示条：昼夜切换后弹出并自动消失
  apps/
    HISApp.js                # HIS 医疗系统（问诊 -> 填写病历 -> 开处方），患者列表随天数/昼夜变化
    SocialApp.js              # 社交软件（室友聊天 -> 收集线索关键词），联系人/对话随天数/昼夜变化
    ChatGTPApp.js             # 仿 ChatGPT 问答助手：可选 1-2 个关键词组合查询，回答中可再引入新关键词
    NotebookApp.js            # 关键词笔记本（关键词+来源+删除按钮，双击可直接在 ChatGTP 中查询该词）
    StatusApp.js              # 状态与属性：状态 / 物品 / 保存 三个标签页
    SettingsApp.js            # 设置（BGM 音量、笔记本排序方式、下班/睡觉确认开关，Win95 风格控件）
  main.js                    # 应用注册表 + 引导启动（含存档预加载与恢复）
data/
  his_schedule.json          # HIS 病人排期：按 { day, phase, patients } 分组的对话树 + 高亮关键词配置
  social_schedule.json       # 社交软件联系人排期：按 { day, phase, contacts } 分组的对话树 + 高亮关键词配置
  medical_records.json       # 病历模板与待填槽位配置
  medicines.json             # 可开具药物列表
  chatgtp_qa.json            # ChatGTP 关键词-回复映射库
  items.json                 # 物品定义（是否消耗/可用、调查文本、使用条件与效果）与初始背包
```

## 核心架构说明

### 1. 窗口系统
- `WindowManager`（单例）统一管理所有 `Win95Window` 实例：创建、置顶聚焦（z-index 递增）、单实例应用（`appId`）。
- `Win95Window` 封装了标题栏拖拽、右下角缩放、最小化/关闭按钮的原生事件绑定，不依赖任何第三方库。

### 2. 数据驱动
- 所有文本、对话分支、病历模板、药品库、AI 问答库、物品定义均以 JSON 存放在 `data/` 目录，通过 `DataLoader.loadJSON()` 异步加载并缓存，新增/修改内容无需改动引擎代码。

### 3. 关键词机制（发布/订阅）
- 对话文本使用 `[[keywordId|显示文本]]` 语法标记特殊词汇；`KeywordManager.renderHighlightedText()` 将其转换为可点击的高亮 `<span>`。
- 点击高亮词汇会调用 `KeywordManager.collect()`，将关键词写入全局 Map 并通过 `eventBus.emit('keyword:collected', ...)` 广播；`KeywordManager.remove()` 则从笔记本中移除并广播 `keyword:removed`。
- `KeywordManager` 同时维护一个全局关键词定义注册表（`registerDefinitions()`），任意应用（如 ChatGTP 的回答、物品调查揭示的线索）都可以引用并高亮此前未在当前上下文中定义过的关键词。
- `NotebookApp`（笔记本：只显示关键词+来源，支持删除，双击可直接跳转 ChatGTP 查询）、`HISApp`（病历下拉选项）、`ChatGTPApp`（选 1-2 个关键词组合查询）均订阅该事件，实现"提取 -> 笔记本查看 -> 填空/查询"的完整闭环，无需相互耦合。

### 4. 对话树（分支对话）
- HIS 病人对话与社交软件联系人对话均采用 `dialogueTree`（`{ start, nodes: { [nodeId]: { speaker, text, options } } }`）的树形结构，而非线性文本数组。
- 每次只展示当前节点的一句话；若该节点带有 `options`，则渲染为可点击的选项按钮，点击后显示玩家选择的台词并跳转到 `next` 指向的节点；`options` 为空数组表示对话分支结束。
- `DialogueProgress`（单例）记录 HIS/社交软件当前选中的 NPC 与对话节点，用于重新打开窗口时恢复到原来的对话位置，也供 `SaveManager` 编码进存档。

### 5. 昼夜循环与内容排期
- `GameState`（单例）保存天数、昼夜阶段与身心状态数值（精力/精神/体力/饱腹）。
- `DayNightSystem` 负责阶段切换（`toggle()`），并广播 `daynight:changed`；HIS / 社交软件等应用**始终可以打开**，不再有阶段限制。
- HIS / 社交软件改为读取 `data/his_schedule.json` / `data/social_schedule.json` 中按 `{ day, phase }` 分组的排期数据，随着天数与昼夜推进展示不同的病人列表/联系人与对话内容；窗口保持打开状态下，切换阶段会实时重新渲染。超出已配置天数时，会在同一阶段的已配置条目间循环，保证游戏不会"没有内容"。
- `Desktop` 与 `Taskbar` 中所有应用**始终显示**在桌面图标与开始菜单中。
- 桌面新增一个动态"下班/睡觉"快捷方式：白天显示"下班"，双击后（可选二次确认，见设置，使用 Win95 风格的 `ConfirmDialog` 而非浏览器原生 `confirm`）调用 `dayNightSystem.toggle()` 进入夜晚；夜晚显示"睡觉"，确认后进入下一天。图标/文案会随昼夜实时切换。
- `NotificationBanner` 订阅 `daynight:changed`，在阶段切换后弹出顶部提示条（几秒后自动消失），告知下一阶段已开启。

### 6. 设置系统
- `SettingsManager`（单例）持久化保存：`bgmVolume`（BGM 音量）、`notebookSortMode`（笔记本分组方式：按类别 / 按收集天数 / 按拼音首字母）、`confirmPhaseChange`（下班/睡觉前是否需要二次确认）。修改后通过 `eventBus.emit('settings:changed', ...)` 广播，任意订阅方（`AudioManager`、`NotebookApp`）会立即生效。
- `SettingsApp` 提供 Win95 风格的音量滑块、排序方式下拉框与确认开关（自绘 3D 边框/勾选样式），均直接调用 `settingsManager.set(...)`。
- `AudioManager` 维护单个隐藏的 `<audio>` 元素，音量始终跟随设置；`setTrack()` 可在后续接入真实 BGM 资源。

### 7. 物品系统
- `ItemManager`（单例）从 `data/items.json` 加载物品定义与初始背包。每个物品定义包含：`consumable`（使用后是否消耗）、`usable`（能否使用）、`inspectText`（调查文本）、`revealKeywords`（调查时揭示的关键词，可选）、`useCondition.requires`（使用所需持有的其他物品，可选）、`useEffect`（使用效果：增删物品 `remove`/`add`，或改变状态数值 `statChanges`）、`failMessage`/`successMessage`。
- `inspect(id)` 显示调查文本并收集 `revealKeywords`；`use(id)` 校验可用性/持有量/使用条件后结算效果，`consumable` 物品会在使用成功后自动移除一个。
- `StatusApp` 的"物品"标签页列出持有物品及数量，并提供"调查"/"使用"按钮（仅 `usable` 的物品显示"使用"）。

### 8. 存档系统
- `SaveManager`（单例）在启动时预加载 `his_schedule.json`/`social_schedule.json`/`items.json`，构建关键词、物品、HIS/社交 NPC+对话节点的规范索引表（决定性顺序，不依赖当前打开了哪个应用）。
- 存档时（`StatusApp` 的"保存"标签页），把天数/昼夜阶段/四项状态数值/已打开窗口/HIS 与社交对话进度/已收集关键词列表/持有物品列表全部按固定顺序打包为字节数组，转换为 base64url 字符串写入 `location.search`（通过 `history.replaceState`，不刷新页面），并展示当前完整网址供玩家复制保存。
- 读档时解析该字符串，还原 `GameState`/`KeywordManager`/`ItemManager`/`DialogueProgress` 并按位掩码重新打开/关闭对应窗口。整个编码只包含索引/数值字节，不包含明文的物品名、关键词 id 等字符串。
- 打开游戏时若网址没有 `?` 后的存档字符串，则从头开始新游戏；否则自动解析并恢复。

## 扩展指南
- **新增应用**：在 `js/apps/` 下新建模块，暴露一个 `launchXApp()` 函数，内部调用 `windowManager.createWindow({ appId, title, icon, content })`，再于 `js/main.js` 的 `APP_REGISTRY` 中注册即可自动出现在桌面图标与开始菜单中（如需存档时能重新打开，也会自动纳入 `SaveManager` 的窗口位掩码，只要 appId 加入 `SaveManager.js` 的 `WINDOW_APP_IDS` 列表）。
- **新增关键词/对话/药品/QA/物品**：直接编辑 `data/` 下对应 JSON 文件，无需修改任何 JS 代码。
- **新增对话分支**：在对应病人/联系人的 `dialogueTree.nodes` 中新增节点，并通过 `options[].next` 连接即可，无需修改应用代码。
- **新增一天的 HIS/社交内容**：在 `his_schedule.json` / `social_schedule.json` 的 `schedule` 数组中追加 `{ day, phase, patients/contacts }` 条目；患者/联系人 `id` 需在整个文件内全局唯一。
- **新增 ChatGTP 组合问答**：在 `chatgtp_qa.json` 的 `entries` 中添加 `{ "keywords": ["关键词A","关键词B"], "answer": "..." }`（1 或 2 个关键词均可），回答文本中可用 `[[keywordId]]` 引入 `keywords` 数组里定义的新关键词。
- **新增物品**：在 `items.json` 的 `items` 中添加定义，并按需加入 `startingInventory` 或某个 `useEffect.add` 中。
