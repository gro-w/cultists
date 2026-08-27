# surrendered by cultists（完蛋，我被邪教徒包围了！）

**surrendered by cultists** 是一款采用 Windows 95 视觉风格的、纯 ES6 模块实现的网页互动游戏。玩家扮演医院实习生，在白天使用医院信息系统处理工作，在下班后回到宿舍与 NPC 交流、整理线索，并逐步揭开被邪教徒包围的真相。

- 英文名：**surrendered by cultists**
- 中文名：**完蛋，我被邪教徒包围了！**
- 技术栈：原生 HTML / CSS / JavaScript ES6 modules
- 构建方式：无构建步骤、无打包器、无第三方框架、无 `package.json`
- 内容方式：JSON 数据驱动

## 当前开发进展

当前版本已经完成工作模式与下班模式的拆分，并形成完整的基础游戏循环：

- **工作模式**：以 Win95 桌面为核心，提供 HIS、夜聊、监控、ChatGTP、关键词笔记本、状态、成就和设置等应用。
- **下班模式**：以宿舍场景为核心，直接操控主角移动，与 NPC 交互，查看墙上游戏时钟，并使用床、手机、电脑和线索墙等场景热点。
- **电脑交互**：宿舍电脑只打开工作桌面，不改变地点、上下班状态或游戏时间；电脑桌面提供“关闭电脑”按钮，关闭后返回宿舍。
- **床交互**：床是宿舍中切换状态的主要入口。工作时间直接去上班；非工作时间确认睡觉，睡眠后进入次日 `08:00` 的工作模式。
- **转场动画**：工作模式与下班模式之间使用关闭/打开笔记本电脑的转场效果。
- **时间系统**：每次有效行动推进 `20` 分钟，行动次数不限；时间本身是行动限制，并支持跨 `16:00`、午夜和睡眠结算。
- **线索墙**：已发现的线索以节点和红线关系图显示，与工作模式中的关键词笔记本区分开。
- **存档与结局**：存档字符串写入 URL，保存状态包括游戏时间、地点、属性、物品、关键词、对话进度、窗口状态等；支持事件、对话、物品、属性和最终阶段等结局触发方式。
- **启动流程**：无存档参数时先显示主菜单，支持新游戏和载入存档；带存档 URL 时自动恢复游戏。

## 本地运行

游戏运行时会通过 `fetch()` 加载 `data/` 下的 JSON 文件，因此必须通过 HTTP(S) 服务器访问，不能直接双击 `index.html`。

```bash
# 在项目根目录执行
python3 -m http.server 8000
```

然后打开：

```text
http://localhost:8000/index.html
```

## 游戏时间规则

- 初始状态：第 1 天、`08:00`、工作模式。
- 工作时间窗口：`08:00 <= time < 16:00`。
- 每次成功对话、调查、ChatGTP 查询或其他计时行动消耗 `20` 分钟。
- 行动数量没有上限；行动是否继续由游戏时间、NPC 状态和结局条件决定。
- 工作时间点击下班：进入下班模式；在工作窗口内会将时间推进到 `16:00`。
- 下班模式在 `08:00–16:00` 点击床：确认后直接进入工作模式，不推进时间、不执行睡眠。
- 下班模式在 `16:00–次日 08:00` 点击床：确认后睡眠，结算恢复效果并进入次日 `08:00` 工作模式。
- 跨过 `00:00` 时立即增加游戏日期。
- `00:00–07:40` 的游戏时钟以红色粗体显示。
- 游戏时间完全由游戏状态驱动，不使用操作系统真实时间。

## 主要操作

### 工作模式

工作模式是带笔记本电脑边框的 Win95 桌面。桌面图标和开始菜单可以打开：

- **HIS 医疗系统**：与患者问诊、填写病历和开具药物。
- **夜聊 Messenger**：与联系人对话并收集关键词。
- **监控画面**：查看监控场景、调查异常和使用物品。
- **ChatGTP**：通过一个或两个关键词查询线索，并消耗精神值。
- **关键词笔记本**：查看已收集关键词、来源和定义。
- **状态与属性**：查看属性、物品、时间和存档。
- **成就**：查看已解锁成就。
- **设置**：调整 BGM 音量、笔记本排序和阶段切换确认选项。

所有应用都可以打开；HIS、夜聊和监控中的内容根据天数与昼夜阶段读取对应数据。

### 下班模式

下班模式显示宿舍场景，不复用工作模式的应用桌面作为主界面：

- 点击场景移动主角。
- 点击主角查看属性、物品和保存游戏。
- 点击 NPC 进行对话；离线 NPC 无法交互。
- 点击床确认去上班或睡觉。
- 点击手机打开 ChatGTP。
- 点击线索墙查看已发现线索的红线关系图。
- 点击电脑打开工作桌面；点击电脑桌面的“关闭电脑”返回宿舍。

## 项目结构

```text
index.html                    # 入口页面、工作桌面、宿舍模式、主菜单与结局界面
css/
  win95.css                   # Win95 基础控件与桌面样式
  apps.css                   # 工作模式应用窗口样式
  modes.css                  # 笔记本边框、宿舍场景与模式转场样式
  mainmenu.css               # 主菜单与结局界面的 CRT 样式
js/
  main.js                    # 应用注册、核心系统预加载与启动流程
  core/                      # 游戏状态、时间、事件、数据、存档和结局等核心系统
  desktop/                   # Win95 桌面、任务栏、主菜单、宿舍模式和提示界面
  apps/                      # HIS、夜聊、监控、ChatGTP、笔记本等应用
 data/
  languages.json             # 可用语言列表
  strings.<lang>.json        # UI 外壳文本
  <lang>/                    # 语言相关的全部游戏内容
    days.json                # 游戏总天数
    day01a.json ... day05b.json # 每天白天/夜晚的排期内容
    keywords.json            # 关键词 ID 与显示内容
    items.json               # 物品与初始背包
    action_budget.json       # 行动时间和睡眠配置
    monitor_scenes.json      # 工作/宿舍场景配置
    npcs.json                # NPC ID、名字、初始好感度与 SAN
    special_events.json      # 按天数/阶段/好感度/SAN 覆盖 NPC 的特殊事件
    chatgtp_qa.json          # ChatGTP 关键词/组合的正常与损坏回答
    endings.json             # 结局、属性触发和最终条件
    medical_records.json     # 病历模板
    medicines.json           # 药品列表
    achievements.json        # 成就定义
    npc_state.json           # NPC 状态配置
    skills.json              # 技能配置
  assets/                    # 场景 SVG 与角色图片
```

## 核心架构

### 单例与事件总线

`js/core/` 中的核心系统采用“类 + 单例”导出方式。系统之间优先通过 `EventBus` 发布和订阅事件，减少应用之间的直接依赖。主要模块包括：

- `GameState`：维护天数、昼夜、地点、精力、精神、体力和饱腹等状态。
- `DayNightSystem`：处理工作/下班/睡眠切换、工作时间边界和最终阶段。
- `ActionBudget`：记录阶段时间，每次有效行动推进 20 分钟，并处理加班、熬夜和睡眠结算。
- `ScheduleData` / `DataLoader`：按语言、天数和昼夜阶段加载 JSON 内容。
- `KeywordManager`：注册、收集和渲染关键词，并维护笔记本数据。
- `ItemManager`：管理物品、调查、使用条件和使用效果。
- `DialogueRunner` / `DialogueProgress`：执行并保存分支对话。
- `NpcStateManager` / `FavorabilityManager`：管理 NPC 在线状态和好感度。
- `EndingManager`：监听事件并解析属性、物品、对话和最终阶段结局。
- `SaveManager`：将完整游戏状态编码为 URL 存档字符串并负责恢复。
- `SettingsManager` / `AudioManager`：管理设置持久化和 BGM。
- `AchievementManager`：根据游戏事件解锁成就。

### 数据驱动内容

游戏内容不写死在应用逻辑中。对话树、排期、关键词、物品、药品、病历、问答、技能、成就和结局均来自 `data/<lang>/`。新增内容通常只需要修改对应 JSON，并保持既有 schema 和 ID 的唯一性。

### 存档格式

`SaveManager` 使用版本化的紧凑编码格式，将数值和索引编码为 base64url 字符串并写入 URL 查询参数。存档包含：

- 天数、昼夜阶段、地点与阶段内时间
- 精神、体力、精力、饱腹和可恢复精神损失
- 物品数量与已收集关键词
- 对话进度、NPC 状态、好感度、技能和成就
- 已打开窗口及其位置和层叠顺序

修改存档字节布局时必须同步提升 `SaveManager.js` 中的存档格式版本；窗口 `appId` 列表也必须保持追加而不重排。

## 扩展方式

- **新增应用**：在 `js/apps/` 创建模块，导出启动函数，在 `js/main.js` 的 `APP_REGISTRY` 中注册。
- **新增工作或宿舍内容**：编辑 `data/<lang>/dayNNa.json` 或 `dayNNb.json`。
- **新增特殊 NPC 事件**：在 `special_events.json` 添加 `npcId`、`phase`、`startDay`/`endDay`、可选的好感度/SAN 范围和 `dialogueTree`；条件满足时会替换当天对应 NPC 的原事件。
- **维护 NPC**：在 `npcs.json` 编辑稳定 `id`、名字、`initialFavorability` 和 `initialSan`。对话节点可以用 `onShow.favorabilityChange` 改变 NPC 好感度。
- **日程角色结构**：`patients` 保持原有结构；`contacts` 中的列表 NPC 使用 `{ "type": "npc", "npcId": "...", "dialogueTree": { ... } }`，名称和头像从 `npcs.json` 读取。非列表角色使用 `{ "type": "other", "name": "...", "avatar": "...", "dialogueTree": { ... } }`。
- **新增关键词**：在 `keywords.json` 中添加 `{ "id": "...", "content": "..." }`，应用只引用关键词 ID。
- **新增对话分支**：在对应 `dialogueTree.nodes` 中添加节点，并通过 `options[].next` 连接。
- **新增 ChatGTP 问答**：在 `chatgtp_qa.json` 的 `entries` 中添加 1～2 个关键词 ID、`answer`、`corruptedAnswer` 和 `corruptedSameAsNormal`。
- **新增物品、药品、结局或成就**：分别编辑对应 JSON 文件，并按现有 schema 配置效果或触发条件。
- **新增语言**：添加语言列表、UI 字符串文件以及完整的 `data/<lang>/` 内容目录。

### 开发人员模式与发布

源码版本支持通过 `http://localhost:8000/?dev` 进入开发人员模式。该模式提供：

- 不改变地址栏的存档字符串快速载入；
- 游戏日期、时间、地点和玩家数值调节；
- 物品任意增加、减少和清空；
- 对话/患者角色 JSON 编辑，以及关键词标记插入；
- 日程角色和患者的新增、删除及分支树编辑；
- ChatGTP、关键词、物品和其他数据 JSON 编辑；
- 将编辑后的日程、问答或数据文件下载为 JSON。

开发工具代码使用 `DEV-TOOLS:START` / `DEV-TOOLS:END` 标记包裹。发布玩家版本时运行：

```bash
node publish.js
```

脚本会重新生成 `publish/`，复制项目文件并移除所有开发工具代码；发布目录不支持 `?dev` 开发入口。

## 验证

项目目前没有测试框架、代码格式化工具或构建流程。提交修改前执行与改动范围对应的静态检查：

```bash
node --check js/main.js
node --check js/desktop/DormMode.js
python3 -m json.tool data/zh-hans/action_budget.json > /dev/null
git diff --check
```

对新增或修改的每个 JavaScript 文件执行 `node --check`，对每个修改的 JSON 文件执行 JSON 校验。浏览器端流程由项目开发者在本地服务器中进行验证。
