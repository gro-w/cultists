# Cultists NG Engine

`ng/` 是 Cultists 的 NG 引擎与 NGL 内容运行目录。当前架构严格分为 Core、Framework、Game 三层；开发工具和探针不属于引擎运行时。

## 三层边界

### Core

Core 只提供通用宿主能力：

- `index.html`：NG 入口页面
- `style.css`：入口页面和通用桌面样式
- `core/engine.js`：公开入口，负责启动 `engine-bootstrap.js`
- `core/engine-bootstrap.js`：平台组合根
- `core/engine-api.js`：通用 Engine API 注册表
- `core/*.js`：Activity、队列、存档、变量、数据、窗口和通用渲染运行时
- `core/desktop*.js`：仿 Windows 95 桌面、任务栏、图标、窗口和指针交互
- `dev/`：开发人员模式及 canonical 数据编辑器

Core 不实现成就、物品、患者、NPC、日历、剧情、结局或其他 Cultists 领域业务。

### Framework

文件名匹配 `data/**/*.framework.json` 的数据属于 Framework 层。Framework 通过 NGL Activity、manager Activity 和声明式数据实现可复用系统，例如：

- `blueprint-nodes.framework.json`
- `databases.framework.json`
- `structures.framework.json`
- `public-variables.framework.json`
- `framework-runtime.framework.json`
- `activities/*-manager.framework.json`

成就、物品、关键词等系统的管理行为必须继续放在 Framework NGL 数据和 Activity 中，不得重新添加到 Core JavaScript。

### Game

`data/` 下除 `*.framework.json` 以外的 JSON 属于 Game 层，包括：

- 患者、NPC、物品、关键词和剧情记录
- 游戏窗口与桌面图标数据
- Game Activity、日程、结局和特殊事件
- 游戏初始状态、种子记录和内容资源引用

Game 层使用 NGL Activity 和数据，不新增原生 JavaScript 业务模块。

## 工具边界

以下内容不属于引擎运行时：

- `probes/`：确定性探针
- `scripts/`：迁移和检查脚本
- `tools/`：迁移兼容代码及审计工具
- `dev-server.js`：本地开发服务器

工具可以读取旧实现用于迁移验证，但生产入口不得导入这些路径。

## 许可边界

- `ng/` 下的引擎代码、通用运行时、Core 数据结构和编辑器（不含 `ng/data/` 的 Game 内容）使用 `ng/LICENSE` 中的 2-Clause BSD 许可
- `ng/data/` 下的 Game 内容，包括故事、角色、图像、音频和其他叙事资产，不包含在该开源许可中
- 如需复用《完蛋，我被邪教徒包围了！》的 Game 内容，请联系项目开发者

## 运行

```bash
cd ng
node dev-server.js
# 打开 http://127.0.0.1:8000/
```

入口页面加载：

```text
index.html
└── core/engine.js
    └── core/engine-bootstrap.js
```

## 验证

在仓库根目录执行：

```bash
node tools/audit-ng-layer-boundary.mjs --strict
```

在 `ng/` 目录执行：

```bash
node --check core/engine.js core/engine-bootstrap.js core/engine-api.js
node --check core/*.js core/desktop*.js dev-server.js
for f in probes/*.mjs; do node "$f" || exit 1; done
python3 - <<'PY'
import json
from pathlib import Path
for path in Path("data").rglob("*.json"):
    json.loads(path.read_text(encoding="utf-8"))
print("JSON_OK")
PY
git diff --check
```

严格边界审计还应确认：Game 层没有原生模块、Framework 文件均为 `*.framework.json`、工具目录没有被生产入口导入。
