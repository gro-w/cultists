# surrounded by cultists（完蛋，我被邪教徒包围了！）

`surrounded by cultists` 是一款 Windows 95 风格的数据驱动网页互动游戏。玩家白天在医院信息系统（HIS）中处理患者，非工作时间回到宿舍，与室友交流、调查物品、收集关键词、面对不可名状的日常，并把选择推进到不同结局。

项目现在使用一套名为 **Cultists 引擎** 的融合引擎，不再分别运行原有引擎和 NG 引擎。引擎分为 `core`、`framework`、`game` 三层：底层负责通用平台，中层提供可复用系统，上层承载本作内容。本项目主要面向 Cultists 引擎（`core` 与 `framework`）开发，以及 `game` 层内容向新引擎的迁移和适配。

## 主要特点

- 原生 HTML、CSS 和 ES modules，无框架、无 bundler、无构建步骤
- JSON 与 NGL 蓝图驱动的 Activity、对话、医疗、物品、关键词、成就、结局、公共变量和 Activity 本地变量
- CL2（Cultists Blueprint & Script Language 2）统一脚本图语言设计草案：以显式节点、`option<x>`、`default` 和纯值表达式直接表示蓝图图结构
- Windows 95 风格桌面、任务栏、开始菜单、窗口和数据驱动应用
- 医院工作与宿舍生活两种场景，以及工作、社交、管理器和主活动队列
- 确定性的游戏时钟：普通行动默认推进 20 分钟，睡眠和跨日按明确边界结算
- 患者诊疗、技能检定、SAN 变化、物品调查、法术、关键词笔记本和多种结局
- 开发模式、canonical 数据编辑器、运行时调试器和确定性探针
- Core 与开发人员模式 i18n locale 模块、语言管理器和蓝图语言节点；用户可见字符串集中存放于 `core/i18n/xx-xx.js`
- 数据驱动设置窗口：可调整 BGM 音量、笔记本排序、阶段切换确认和界面语言
- 分层 BGM：game 数据保存曲目/规则，framework 管理优先级，NGL 节点控制播放、停止、音量和临时层恢复
- 位置场景窗口从 canonical 位置数据库显示当前地点背景和可调查区域

## 本地运行

项目没有安装依赖或构建步骤。需要通过 HTTP 服务运行，以便浏览器加载 ES modules 和 JSON：

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

然后打开：

```text
http://127.0.0.1:8000/
```

开发者需要编辑 canonical 数据时，可启动本地开发服务器：

```bash
node dev-server.js
```

开发模式地址严格为 `http://127.0.0.1:8000/?dev`。开发服务器只绑定本机，不应暴露到公共网络；开发工具和写盘 API 不属于玩家版。

## 游戏规则概览

- 游戏从第 1 天 `08:00` 开始，初始地点为工作场所，处于白天和上班状态
- 工作窗口为 `[08:00, 16:00)`；它与天文白昼 `[06:00, 18:00)` 是不同概念
- 当前工作批次未完成时不能下班；夜班批次未完成时不能睡觉
- 普通成功行动默认消耗 20 分钟；跨过午夜时日期增加，次日 `08:00` 结算睡眠、医疗和日结事项
- 当前可玩日历为第 1–7 天，日历界面会额外显示第 8–31 天的未解锁占位

## 项目结构

```text
index.html                 浏览器入口
core/                      融合引擎 core：平台、Activity、窗口、变量和存档
data/                      framework/game 的蓝图、窗口、数据库、manifest 和资源
probes/                    确定性探针
media/                     历史宣传资源和设计稿
```

`data/` 中的 canonical 内容由 `data/game-manifest.json` 配置；旧版 `data/game-content/` 已完成迁移并从仓库删除。Activity 定义位于 `data/activities/`，窗口定义位于 `data/windows/`，数据库位于 `data/databases/`；本地变量命名定义位于 `data/local-variables.framework.json`，值只存在于各 Activity 实例。

## 三层引擎

| 层 | 作用 |
| --- | --- |
| `core` | 提供与具体游戏无关的桌面、窗口、Activity 执行、数据加载、基础变量、事件、存档和受控能力 |
| `framework` | 使用 NGL 和数据实现工作时间、`phase`、`duty`、`location`、工作状态机、队列、资源、变量、Widget 与 UI 预制系统 |
| `game` | 使用 NGL 和数据实现本作的医院、患者、宿舍、社交、物品、成就、剧情和结局 |

依赖方向为 `game → framework → core`。游戏内容通过稳定 ID、manifest 和 schema 连接；玩家可见的计时和状态副作用由 Activity 执行，而不是由窗口直接修改。

## 内容制作

常见内容入口包括：

- `data/activities/`：工作、社交、医疗、宿舍、成就、事件和结局 Activity
- `data/windows/`：桌面应用和窗口布局定义
- `data/databases/`：患者、症状、诊断、NPC、关键词、物品、成就等 canonical 数据
- `data/activity-lists/`：按用途组织 Activity 的清单
- `data/game-manifest.json`：内容包、初始状态、队列和入口配置

编辑器写入 canonical 数据，存档调试器只修改存档和运行时状态。运行时集合可以通过数据定义中的 `stateAliases` 兼容旧稳定 ID，恢复时 canonical ID 优先；也可以通过 `activityQueueId` 把 Activity 队列投影给 NGL 窗口列表，队列变化会自动触发窗口刷新。Activity 对话 transcript 支持只读回放，不会重新执行剧情节点。新增内容应优先使用 NGL 和数据，不要把业务逻辑写进 JavaScript。

ChatGTP QA 与 Turtle Soup 的运行时数据分别由 `data/databases/chatgtpQaEntries.json` 和 `data/databases/turtleSoupPuzzles.json` 唯一持有；迁移工具、manifest 和探针不得重新引入已删除的重复 seed/native 文件。

## 开发与验证

典型检查命令：

```bash
for f in $(git ls-files '*.js'); do node --check "$f"; done
git diff --check
node tools/verify-publish.js
```

JSON 可用 Python `json.load()` 全量校验；复杂状态和 Activity 变化可运行对应的 `probes/*.mjs`。这些检查不等同于浏览器交互验证，UI 行为只有真实启动并操作页面后才能确认。

## 版权与许可证

Cultists 引擎（`core` 与 `framework`）遵循根目录 [`copying.txt`](copying.txt) 的 BSD 2-Clause License。`game` 层游戏内容保留版权，不因引擎开源而自动获得复制、修改或再分发许可；具体权利以内容文件声明和版权所有者授权为准。外部代码、数据、图片、音频、视频和字体必须另行确认许可证并保留来源。项目只接受许可证明确允许商业使用和再分发的免费开源字体，不使用未经确认授权的版权字体。

## 贡献与进一步阅读

- 修改引擎或迁移游戏数据后，应同步检查并更新 `AGENTS.md`、`agent-notes.md` 和本文件，分别保持代理规则、开发补充信息和人类阅读版说明一致
- [`AGENTS.md`](AGENTS.md)：贡献者和编码代理必须遵守的工程规则
- [`agent-notes.md`](agent-notes.md)：目录、manifest、运行时职责和维护命令的补充说明
- [`docs/cl2-language.md`](docs/cl2-language.md)：CL2 统一脚本图语言设计草案；当前运行时仍以 NGL 为准
- `data/game-manifest.json`：当前融合引擎的内容入口
- `tools/publish.js`：玩家版发布脚本