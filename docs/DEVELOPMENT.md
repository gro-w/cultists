# 开发与协作指南

## 运行方式

### 只读静态服务器

适合只运行游戏、不需要开发人员模式写盘时使用：

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

打开 `http://127.0.0.1:8000/`。

### 开发服务器

开发数据编辑时使用：

```bash
node dev-server.js
```

默认绑定 `127.0.0.1:8000`，然后打开：

```text
http://127.0.0.1:8000/?dev
```

若 8000 已被占用：

```bash
node dev-server.js --port 8001 --lang zh-hans
```

并打开对应的 `http://127.0.0.1:8001/?dev`。开发服务器只允许修改已经存在于 `data/<lang>/` 的 JSON 文件，不会创建任意路径。它没有登录认证，不得暴露到公网。

## 开发人员模式

源码中严格的 `?dev` 查询串会启用一个独立的“开发人员模式”窗口。窗口上半部是**数据库 App**，下半部是中性的**调试器**；数据库图标中，关键词、ChatGTP 问答、NPC 列表、全局变量定义、日程、BGM、位置和电脑内容使用中性颜色表示较为成熟，其余专用编辑器使用蓝色表示仍在开发。两部分都以桌面图标列出入口，双击图标会在新窗口打开对应编辑器或运行时工具。通用 JSON 编辑器已经移除。数据库 App 修改数据定义，调试器不写入静态数据库文件。

- 「保存到内存」只改变当前页面运行时数据。
- 各专用编辑器的「下载」导出其对应 JSON 文件。
- 开发服务器可用时，「写入磁盘」会直接更新项目文件。
- 外部文件变化通过 SSE 通知，DataLoader 会清理对应缓存。
- 开发服务器是便利工具，不是权限边界。

新增开发工具代码必须放在 `// DEV-TOOLS:START` / `// DEV-TOOLS:END`（或对应 CSS/HTML 注释）之间，以便 `publish.js` 删除。

### 日程编辑器工作台

「日程编辑器」首页是一个大画面，包含四张独立日程表：Social 日期日程表、Work 日期日程表、公共日程表和其他日程表。前两张表分别列出日期 Social/Work 文件；公共日程表使用下拉框选择 `socialpub.json`、`workpub.json` 或 `mainpub.json`；其他日程表使用下拉框选择 `endings.json`、`special_events.json` 或 `maininit.json`。每张表都有编辑按钮及「从当前游戏读取」「从文件读取」「导出 JSON」「写入磁盘」四类文件级操作，每次只处理一个 JSON 文件。空日程也可以打开蓝图编辑器，之后通过「＋ 日程条目」新建条目。编辑按钮会通过 `WindowManager` 打开填满窗口的独立蓝图子窗口；子窗口可以同时打开多个，并且左侧只列出当前文件中的条目。蓝图窗口顶部同样只有四个单文件操作按钮，不提供项目级新建、保存或载入；未选中节点时可编辑当前日程 ID 和 `displayName`（显示名称）。

## 修改流程

1. 先读 `AGENTS.md`、相关模块、数据 schema 和所有调用点。
2. 保持职责归属：全局状态放核心单例，跨模块通知用 `EventBus`，内容放 JSON；所有普通计时操作先创建日程实例，由 `ScheduleRunner`/`ItemScheduleRuntime` 执行。
3. 不要在 App 中直接调用 `TimeService.advanceBy()`，不要在日程创建前调用 `SpellManager.learn()`、`MedicalCaseManager.submit()` 或写入 NPC offline 状态。法术学习必须是“240 分钟 `consumeTime` → `spellOperation`”，NPC 离线必须是 realtime 日程。
4. 所有文本文件使用 LF；不读取、不提交凭据和 `.env` 文件。
5. 不添加构建工具、框架或依赖，除非先讨论。
6. 修改后执行静态检查：

```bash
for f in $(git ls-files '*.js'); do node --check "$f"; done
python3 - <<'PY'
import json, subprocess
for name in subprocess.check_output(['git', 'ls-files', '*.json'], text=True).splitlines():
    with open(name, encoding='utf-8') as fh:
        json.load(fh)
print('JSON OK')
PY
git diff --check
```

只需根据实际修改范围检查文件，但新增/修改的 JS 和 JSON 不得遗漏。项目没有测试框架；复杂状态变更应补充确定性的 Node 探针或脚本探针。

## 存档注意事项

`SaveManager.js` 当前格式为 v13，payload 包括游戏状态、TimeService、四条队列、医疗、关键词、背包、NPC 状态、好感度、场景物品、对话进度、结局锁定、全局变量、法术、动态日程和窗口布局。任何 payload 结构或编码布局改变都要评估版本兼容性。旧版本不会自动迁移。新增可恢复窗口时，要把 `appId` 追加到 `WINDOW_APP_IDS`，并注册 launcher。

## 发布玩家版本

```bash
node publish.js
```

发布脚本会重建 `publish/`，删除开发工具区块，并排除 `dev-server.js`、`publish.js`、`.git`、`node_modules`。发布前确认：

- `publish/` 不包含 `DEV-TOOLS`、`DeveloperMode` 或开发服务器。
- 发布版不依赖 `?dev`。
- 运行 `node --check publish/js/main.js`。
- 不把 `publish/` 目录或本地数据修改误提交。

## Git 协作

- 小改动：Conventional Commit 后直接 push。
- 跨多个核心系统、破坏存档兼容性或足够大的功能：创建独立分支并发 Pull Request。
- 提交前检查 `git status --short`、`git diff --stat`、`git diff --check` 和新增行中的凭据。
- 不要提交、推送或改写历史，除非任务明确要求。
