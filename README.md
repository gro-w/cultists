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
    GameState.js             # 主角状态单例：精力/精神/体力/天数/昼夜阶段
    DayNightSystem.js        # 昼夜循环管理：阶段切换、应用可用性判断
  desktop/
    Desktop.js               # 桌面图标渲染与启动
    Taskbar.js                # 任务栏（窗口标签、时钟、开始菜单、昼夜指示）
  apps/
    HISApp.js                # 白天：HIS 医疗系统（问诊 -> 填写病历 -> 开处方）
    SocialApp.js              # 夜晚：社交软件（室友聊天 -> 收集线索关键词）
    ChatGTPApp.js             # 全天：仿 ChatGPT 问答助手（关键词命中配置库作答）
    NotebookApp.js            # 全天：关键词笔记本（实时展示已收集关键词）
    StatusApp.js              # 全天：主角状态显示器
  main.js                    # 应用注册表 + 引导启动
data/
  dialogues_day.json         # 白天病人对话树 + 高亮关键词配置
  dialogues_night.json       # 夜晚室友对话内容 + 高亮关键词配置
  medical_records.json       # 病历模板与待填槽位配置
  medicines.json             # 可开具药物列表
  chatgtp_qa.json            # ChatGTP 关键词-回复映射库
```

## 核心架构说明

### 1. 窗口系统
- `WindowManager`（单例）统一管理所有 `Win95Window` 实例：创建、置顶聚焦（z-index 递增）、单实例应用（`appId`）、批量关闭（用于昼夜切换时关闭阶段限定应用）。
- `Win95Window` 封装了标题栏拖拽、右下角缩放、最小化/关闭按钮的原生事件绑定，不依赖任何第三方库。

### 2. 数据驱动
- 所有文本、对话分支、病历模板、药品库、AI 问答库均以 JSON 存放在 `data/` 目录，通过 `DataLoader.loadJSON()` 异步加载并缓存，新增/修改内容无需改动引擎代码。

### 3. 关键词机制（发布/订阅）
- 对话文本使用 `[[keywordId|显示文本]]` 语法标记特殊词汇；`KeywordManager.renderHighlightedText()` 将其转换为可点击的高亮 `<span>`。
- 点击高亮词汇会调用 `KeywordManager.collect()`，将关键词写入全局 Map 并通过 `eventBus.emit('keyword:collected', ...)` 广播；`KeywordManager.remove()` 则从笔记本中移除并广播 `keyword:removed`。
- `KeywordManager` 同时维护一个全局关键词定义注册表（`registerDefinitions()`），任意应用（如 ChatGTP 的回答）都可以引用并高亮此前未在当前上下文中定义过的关键词。
- `NotebookApp`（笔记本，支持删除）、`HISApp`（病历下拉选项）、`ChatGTPApp`（关键词组合查询）均订阅该事件，实现"提取 -> 笔记本查看 -> 填空/查询"的完整闭环，无需相互耦合。

### 4. 对话树（分支对话）
- HIS 病人对话与社交软件联系人对话均采用 `dialogueTree`（`{ start, nodes: { [nodeId]: { speaker, text, options } } }`）的树形结构，而非线性文本数组。
- 每次只展示当前节点的一句话；若该节点带有 `options`，则渲染为可点击的选项按钮，点击后显示玩家选择的台词并跳转到 `next` 指向的节点；`options` 为空数组表示对话分支结束。

### 5. 昼夜循环
- `GameState`（单例）保存天数、昼夜阶段与身心状态数值。
- `DayNightSystem` 负责阶段切换（`toggle()`）、判断某个应用在当前阶段是否可用（`isAppAvailable()`），并在切换时自动关闭不可用阶段的窗口。
- `Desktop` 与 `Taskbar` 订阅 `daynight:changed` 事件，实时更新图标可见性与状态指示。
- 目前通过任务栏"开始菜单 -> 切换昼夜（测试用）"手动触发，方便验证白天/夜晚应用切换与全流程贯通；后续可替换为基于剧情进度或时间的自动切换逻辑。

## 扩展指南
- **新增应用**：在 `js/apps/` 下新建模块，暴露一个 `launchXApp()` 函数，内部调用 `windowManager.createWindow({ appId, title, icon, content })`，再于 `js/main.js` 的 `APP_REGISTRY` 中注册即可自动出现在桌面图标与开始菜单中。
- **新增关键词/对话/药品/QA**：直接编辑 `data/` 下对应 JSON 文件，无需修改任何 JS 代码。
- **新增对话分支**：在对应病人/联系人的 `dialogueTree.nodes` 中新增节点，并通过 `options[].next` 连接即可，无需修改应用代码。
- **新增 ChatGTP 组合问答**：在 `chatgtp_qa.json` 的 `entries` 中添加 `{ "keywords": ["关键词A","关键词B"], "answer": "..." }`（1 或 2 个关键词均可），回答文本中可用 `[[keywordId]]` 引入 `keywords` 数组里定义的新关键词。
- **新增昼夜阶段限定应用**：在 `DayNightSystem.isAppAvailable()` 中补充判断分支。
