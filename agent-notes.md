# agent-notes.md

本文件是给编码代理使用的项目补充说明。必须遵守的规则在 [`AGENTS.md`](AGENTS.md)，人类阅读版在 [`README.md`](README.md)。本文只记录当前融合引擎的背景、目录、入口和验证方法，不把旧引擎或 NG 引擎描述成可运行的并行系统。

## 项目概览

- 项目名称：`surrounded by cultists`（《完蛋，我被邪教徒包围了！》）。项目引擎称为 **Cultists 引擎**。
- 主要开发范围是 Cultists 引擎的 `core` 与 `framework`，以及把 `game` 层的既有内容迁移、适配到新引擎；不是继续维护两套旧运行时。
- 这是一个 Windows 95 风格、原生 HTML/CSS/ES modules、无构建步骤的中文数据驱动网页互动游戏。
- 当前唯一运行时是融合引擎：`core` 提供通用宿主，`framework` 提供可复用系统，`game` 由 NGL 蓝图和数据实现具体游戏内容。
- `index.html` 是浏览器入口；`core/engine.js` 是引擎入口，读取 `data/game-manifest.json`，加载 framework 与 game 内容并启动桌面。
- 根目录的 `data/game-content/legacy/` 和 `tools/migration/` 是迁移/对照资料，不是当前运行时的第二套引擎。

## 目录索引

```text
index.html                 浏览器入口
core/                      融合引擎 core：宿主运行时、Activity、窗口、变量、存档
data/                      framework/game 的 manifest、NGL 蓝图、窗口、数据库和资源
dev/                       开发人员模式、数据库编辑器和存档/运行时调试器
probes/                    确定性运行时探针，不属于玩家运行时
tools/                     发布、迁移和审计脚本，不属于玩家运行时
data/game-content/legacy/  迁移保留的旧数据参考
media/                     历史宣传资源和设计稿
```

当前 manifest 的主要连接关系：`game-manifest.json` → `framework-manifest.json`、`activity-manifest.json`、窗口 manifest、数据库、公共变量和 Activity 列表。默认 Activity 是 `default`，队列定义包含 `work`、`social`、`managers`、`main` 以及窗口/Widget/桌面事件队列。

## 本地运行

只读静态服务器：

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

开发服务器（开发模式下提供受限的 canonical 数据读写 API）：

```bash
node dev-server.js
node dev-server.js --port 8001 --lang zh-hans
```

打开 `http://127.0.0.1:8000/`；开发工具入口只使用 `http://127.0.0.1:8000/?dev`。开发服务器仅绑定本机，写盘前仍须经过编辑器 schema 校验。不要把开发服务器暴露到公共网络。

## 运行时职责

| 层/模块 | 职责 |
| --- | --- |
| `core/engine.js`、`engine-bootstrap.js` | 加载 manifest，组装 Cultists 引擎 core 能力并启动平台 |
| `ActivityDefinitionStore`、`ActivityRunner`、`ActivityQueue*` | 加载、排队、执行和恢复 Activity |
| framework 的时间/状态 Activity 与数据 | 工作时间、`phase`、`duty`、`location`、时间推进、上下班/睡眠边界和工作状态机 |
| `GameClock` 等 core 基础设施 | 提供与具体工作语义无关的确定性时钟和状态存储能力 |
| `WindowManager`、`WindowDefinitionStore`、桌面模块 | 桌面、窗口、Widget 和布局 |
| `DataStore`、`DataStructureManager`、`PublicVariableManager` | canonical 数据、结构定义和公共变量 |
| `SaveManager`、`VariableStore`、`EventStateRegistry` | 存档、运行时变量、事件状态和恢复 |
| `data/activities/`、`data/windows/`、`data/databases/` | NGL Activity、窗口定义和游戏数据库 |
| `dev/`、`dev-server.js` | 开发编辑器、调试器和本地数据写盘 |

业务行为应进入 Activity 蓝图和数据，不应在窗口或入口脚本中新增业务副作用。需要原生能力时，按 `game → framework → core` 方向抽象为通用能力。

## 状态与内容约定

- framework 默认状态：第 1 天 `08:00`，`phase=day`、`duty=on-duty`、`location=work`。
- framework 工作窗口是 `[08:00, 16:00)`；普通成功行动默认消耗 20 分钟；游戏时间不依赖系统时钟。工作状态机及上述字段的语义由 framework 负责，core 不包含这些游戏/工作领域语义。
- 玩家可见计时和持久化副作用通过 Activity 执行。工作、社交、管理器和主队列由 manifest 配置，不能在入口中按业务语义偷偷插入 Activity。
- 游戏内容使用稳定 ID。窗口、Activity、数据库、公共变量和资源之间通过 manifest/schema 连接。
- 公共变量、数据库、窗口、Activity 和存档各有边界；数据库编辑器写 canonical 数据，存档调试器只改运行时存档。
- 详细 schema 以实际 `data/*.json` 和对应 loader/validator 为准；修改 schema 时必须同步编辑器、运行器、调试器和探针。

## 常用验证

项目没有统一测试框架，通常按改动范围选择：

```bash
# JavaScript 语法
for f in $(git ls-files '*.js'); do node --check "$f"; done

# JSON 全量校验
python3 -c 'import json, pathlib; [json.load(open(p, encoding="utf-8")) for p in pathlib.Path(".").rglob("*.json") if ".git" not in p.parts and "publish" not in p.parts]'

# 空白与发布
git diff --check
node tools/publish.js
node --check publish/core/engine.js
```

针对具体状态或 Activity，优先运行对应的 `probes/*.mjs`。浏览器交互验证只有实际启动并操作页面后才能报告为通过。

## 发布与版权

`tools/publish.js` 生成玩家版 `publish/`，排除 `dev/`、`tools/`、`probes/`、`dev-server.js` 和迁移资料，并移除 `DEV-TOOLS` 区块。Cultists 引擎遵循根目录 [`copying.txt`](copying.txt) 的 BSD 2-Clause License；`game` 层游戏内容保留版权，除非内容文件另有声明，不得擅自再分发。外部素材和字体仍需分别确认许可证、保留来源和版权信息。项目不使用未经确认可商业使用的版权字体。

## 相关文件

- [`AGENTS.md`](AGENTS.md)：代理必须遵守的架构、版权、字体、修改和验证规则。
- [`README.md`](README.md)：面向玩家、贡献者和普通读者的项目介绍。
- `data/game-manifest.json`：当前内容包入口和初始状态。
- `data/framework-manifest.json`：framework 文档与通用运行时连接。
- `data/activity-manifest.json`：Activity ID 到蓝图文件的清单。
- `tools/publish.js`：玩家版发布脚本。