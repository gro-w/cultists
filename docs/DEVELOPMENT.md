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

源码中严格的 `?dev` 查询串会启用开发人员模式。当前工具包括状态、NPC、背包、对话树、患者、关键词、ChatGTP、NPC、全局变量和 JSON 编辑器。

- 「保存到内存」只改变当前页面运行时数据。
- 「下载」导出 JSON 文件。
- 开发服务器可用时，「写入磁盘」会直接更新项目文件。
- 外部文件变化通过 SSE 通知，DataLoader 会清理对应缓存。
- 开发服务器是便利工具，不是权限边界。

新增开发工具代码必须放在 `// DEV-TOOLS:START` / `// DEV-TOOLS:END`（或对应 CSS/HTML 注释）之间，以便 `publish.js` 删除。

## 修改流程

1. 先读 `AGENTS.md`、相关模块、数据 schema 和所有调用点。
2. 保持职责归属：全局状态放核心单例，跨模块通知用 `EventBus`，内容放 JSON。
3. 所有文本文件使用 LF；不读取、不提交凭据和 `.env` 文件。
4. 不添加构建工具、框架或依赖，除非先讨论。
5. 修改后执行静态检查：

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

`SaveManager.js` 当前格式为 v11，payload 包括游戏状态、双队列、医疗、关键词、背包、全局变量、法术和窗口布局。任何 payload 结构或编码布局改变都要评估版本兼容性。旧版本不会自动迁移。新增可恢复窗口时，要把 `appId` 追加到 `WINDOW_APP_IDS`，并注册 launcher。

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
