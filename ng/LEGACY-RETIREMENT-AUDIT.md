# 融合引擎外部代码与资源审计报告

- 审计对象：当前工作树 `W:/_/cultists`
- 审计时间：2026-09-11T07:42:05Z（与 `ng/scripts/audit-legacy-ng.mjs` 输出一致）
- 当前入口：根目录 `index.html` → `ng/style.css` → `ng/core/engine.js`
- 审计性质：静态引用、清单、内容哈希和确定性探针审计；不是完整浏览器行为等价性证明
- 重要背景：工作树本身存在大量迁移中的 staged/modified/untracked 变更，本报告不把当前变更误认为已提交的最终状态

## 1. 结论摘要

### 可以从当前 NG 运行路径移除的旧运行时表面

下列目录不被根入口或 `ng/core`、`ng/data`、`ng/dev` 生产运行时代码导入，且已有 NG 入口或替代实现：

| 旧路径 | 当前替代 | 结论 |
| --- | --- | --- |
| `legacy/index.html` | 根 `index.html` + `ng/core/engine.js` | 可安全删除（相对于当前 NG 运行时） |
| `legacy/dev-server.js` | `ng/dev-server.js` | 可安全删除（相对于当前 NG 运行时） |
| `legacy/css/` | `ng/style.css` 及 NG 窗口样式 | 可安全删除旧运行时资源；不等于已证明逐项 UI 等价 |
| `legacy/js/` | `ng/core/`、`ng/dev/`、NGL/数据 | 可安全删除旧运行时代码；不等于已证明所有旧行为已迁移 |
| `legacy/media/` | 当前 NG 入口不引用；海报/展示资源不属于 NG 游戏运行路径 | 可删除，但需确认是否需要保留历史宣传物 |

这些路径的“可删除”仅表示**当前 NG 入口不需要它们**。若希望保留回滚能力，应先打包归档，而不是继续放在运行时仓库中。

### 不能在本轮直接删除的内容

`legacy/data/` 不能整体判定为安全删除，原因是：

1. `ng/probes/legacy-reference-data-probe.mjs` 和 `ng/probes/migrate-legacy-blueprint-probe.mjs` 仍直接读取 `legacy/data/zh-hans`。
2. `ng/scripts/migrate-legacy-blueprint.mjs`、`migrate-legacy-chatgtp-qa.mjs`、`migrate-legacy-medical-reference.mjs` 仍将 `legacy/data` 作为迁移源。
3. `ng/data/game-content/legacy-content-index.json` 声称保留了完整源包，但实际只保留了 13/54 个 `game-data` JSON；不能把它当作完整替代源。

因此，旧数据应分为“已进入 NG canonical 数据层”和“只保留在 legacy 源目录”两类，不能按目录名批量删除。

### 当前迁移的阻塞问题

- 内容索引记录总数为 136：80 个资源、54 个游戏 JSON、2 个本地化文件。
- 80/80 个资源的目标文件存在。
- 2/2 个本地化文件的目标文件存在。
- 仅 13/54 个游戏 JSON 的 preservation target 存在，缺失 41 个。
- 已存在的 13 个 JSON target 与源文件有 13 个 SHA-256 不一致；这说明它们是转换/规范化结果，不是原样备份，不能作为源文件等价替代。
- `ng/data/data-files.json` 的 225 个文件引用全部存在。
- 三层边界审计通过，NG Game 层没有原生 JS 模块。
- 51 个 NG 确定性探针中 49 个通过、2 个失败：
  - `ng/probes/legacy-reference-data-probe.mjs`：资源路径前缀断言不一致（实际 `ng/data/assets/...`，探针期望 `data/assets/...`）。
  - `ng/probes/off-duty-window-probe.mjs`：`window.onCreate` 图中 `consume` 流程节点不可从流程起始节点到达。

在这两个探针修复并重新通过、且源数据引用迁移到 NG preservation target 之前，不建议删除 `legacy/data/`。

## 2. 规模盘点

| 项目 | 数量/大小 |
| --- | ---: |
| Legacy 中文数据 JSON（审计脚本口径） | 54 |
| NG canonical JSON（排除 `game-content/legacy` preservation mirror） | 230 |
| Legacy 资源文件 | 80 |
| NG 资源文件 | 80 |
| Legacy 代码文件（`legacy/js`） | 90 / 890,208 bytes |
| Legacy CSS 文件 | 6 / 87,418 bytes |
| Legacy 数据目录文件 | 136 / 167,516,477 bytes |
| Legacy 文档文件 | 10 / 133,659 bytes |
| Legacy 脚本文件 | 22 / 49,494 bytes |
| Legacy media 文件 | 3 / 1,014,661 bytes |
| NG Framework 数据文件 | 8 |
| NG Game 原生 JS 模块 | 0 |

`legacy/data` 的 167 MB 主要由 `chatgtp_qa.json` 等原始数据构成；不能只根据“NG 有对应数据库”就判定原始文件已经完整迁移。

## 3. 旧运行时代码审计

### 3.1 可删除的旧代码组

| 代码组 | 旧路径 | NG 对应路径 | 运行时引用结论 |
| --- | --- | --- | --- |
| 应用层 | `legacy/js/apps/` | NG 窗口 JSON、Widget、Activity | 根入口不加载；可删除旧实现 |
| 核心管理器 | `legacy/js/core/` | `ng/core/` + Framework/Game NGL | 根入口不加载；可删除旧实现 |
| 桌面层 | `legacy/js/desktop/` | `ng/core/desktop*.js` | 根入口不加载；可删除旧实现 |
| 旧开发工具 | `legacy/js/desktop/Dev*.js`、`DeveloperMode.js` | `ng/dev/` | NG 开发入口不导入；可删除旧实现 |
| 旧 CSS | `legacy/css/` | `ng/style.css` | 根 HTML 不引用；可删除旧样式 |
| 旧启动页/开发服务器 | `legacy/index.html`、`legacy/dev-server.js` | 根 `index.html`、`ng/dev-server.js` | 不在当前启动链；可删除 |

上述结论不覆盖 `ng/probes/`、`ng/scripts/` 和 `tools/` 的离线迁移用途。生产入口没有导入这些工具目录，但它们仍可能读取 legacy 源数据。

### 3.2 旧代码不应继续作为兼容运行时

NG 边界审计已确认：

- `ng/core/` 没有导入 `probes`、`tools`、`scripts` 或 `dev-server.js`。
- `ng/data/` 的 Framework 文件均使用 `*.framework.json` 命名。
- `ng` Game 层没有原生 JavaScript 文件。
- 根入口没有引用旧 `js/`、旧 `data/zh-hans/` 或旧 `data/assets/` 路径。

因此，`legacy/js`、`legacy/css` 和旧入口继续留在仓库中的主要价值是回滚、对照和迁移取证，不是 NG 运行时依赖。

## 4. 数据与资源审计

### 4.1 已有 NG 目标、但不能全部按“原样已迁移”处理的内容

`ng/data/game-content/legacy-content-index.json` 的记录分类如下：

| 类型 | 源记录 | 目标存在 | 目标与源字节一致 |
| --- | ---: | ---: | ---: |
| `game-asset` | 80 | 80 | 80 个源资源与 NG 资源内容哈希相同 |
| `game-localization` | 2 | 2 | 需以索引 SHA-256 逐项复核后再删除源 |
| `game-data` | 54 | 13 | 0/13 可视为原样 preservation copy |

资源方面，`legacy/data/assets/` 与 `ng/data/assets/` 有 80/80 个文件内容相同；这证明资源已复制到 NG 资源目录，但不证明每个资源都已被实际运行时引用。`ng/data/media.json`、物品/NPC/地点等数据库中的资源引用应作为 canonical 引用继续保留。

### 4.2 尚未进入完整 NG preservation mirror 的数据

以下 41 个源 JSON 在 `ng/data/game-content/legacy/` 没有对应目标，不能删除 `legacy/data/zh-hans/` 中的源文件：

```text
applist.json
bgm.json
chatgtp_daily_import.json
chatgtp_qa.json
diagnoses.json
endings.json
global_variables.json
item_placements.json
keywords.json
maininit.json
mainpub.json
social01a.json
social01b.json
social02a.json
social02b.json
social03a.json
social03b.json
social04a.json
social04b.json
social05a.json
social05b.json
social06a.json
social06b.json
social07a.json
social07b.json
socialpub.json
work01a.json
work01b.json
work02a.json
work02b.json
work03a.json
work03b.json
work04a.json
work04b.json
work05a.json
work05b.json
work06a.json
work06b.json
work07a.json
work07b.json
workpub.json
```

已存在但发生转换/规范化的 13 个 JSON 为：

```text
achievements.json
app_his_custom.json
calendar.json
cg.json
items.json
locations.json
medicines.json
npcs.json
skills.json
social_apps.json
special_events.json
time_rules.json
turtle_soups.json
```

这些文件的旧源仍然具有迁移对照价值；只有在完成 stable-ID、记录数量、字段和行为探针核对后，才能删除对应源。

### 4.3 明确不属于当前 NG 运行时的资源

- `legacy/media/poster-A4.png`
- `legacy/media/poster-a2.html`
- `legacy/media/poster-a4-landscape.html`

它们没有被根入口或 NG 运行时引用。它们不是“已迁移进 NG 游戏内容”的资源，是否删除取决于是否需要保留宣传物/设计源文件。

## 5. 删除建议分级

### P0：可以在不改变 NG 启动链的前提下删除

建议先压缩归档，然后删除：

```text
legacy/index.html
legacy/dev-server.js
legacy/css/
legacy/js/
legacy/docs/
legacy/scripts/
legacy/media/
```

`legacy/docs/`、`legacy/scripts/` 虽不属于运行时，但删除会损失迁移历史和旧格式工具；若保留审计可追溯性，建议单独归档而非随源码删除。

### P1：完成引用迁移后可删除

先把以下工具和探针改为读取 `ng/data/game-content/legacy/` 或新的 canonical 数据源，再删除：

```text
legacy/data/zh-hans/
```

同时需要更新：

```text
ng/probes/legacy-reference-data-probe.mjs
ng/probes/migrate-legacy-blueprint-probe.mjs
ng/scripts/migrate-legacy-blueprint.mjs
ng/scripts/migrate-legacy-chatgtp-qa.mjs
ng/scripts/migrate-legacy-medical-reference.mjs
```

由于 preservation mirror 当前缺 41 个数据文件，不能现在执行 P1 删除。

### P2：暂不删除

- `ng/data/game-content/legacy/`：当前承担迁移保留/对照角色，且本身还不完整。
- `ng/data/game-content/legacy-content-index.json`：在 preservation 完整性修复前不能作为删除依据。
- `ng/data/assets/`：80 个资源已进入 NG，但仍是当前 canonical 资源目录。
- `ng/data` 下的 canonical 数据、Activity、窗口和 Framework 文件：当前 manifest/loader 使用，不能按与旧文件同名或同内容猜测删除。

## 6. 验证记录

已执行：

```text
node tools/audit-ng-layer-boundary.mjs --strict    PASS
JSON parse ng/data/**/*.json (246 files)           PASS
node --check ng/core/engine.js                     PASS
node --check ng/core/engine-bootstrap.js           PASS
node --check ng/core/engine-api.js                 PASS
git diff --check                                 PASS
ng/probes/*.mjs                                   49 PASS / 2 FAIL
```

未执行浏览器交互验证，因此本报告不宣称窗口行为、剧情流程、资源显示和旧引擎 UI 已完全等价。

## 7. 建议的后续顺序

1. 修复两个失败探针，避免以失败的迁移验证为依据删除源文件。
2. 修正 `legacy-content-index.json` 的 preservation 语义：补齐缺失的 41 个 JSON，或明确把已转换文件从“原始保留索引”中拆出。
3. 将五个仍依赖 `legacy/data` 的探针/迁移脚本切换到明确的源边界；迁移工具如仍需源目录，应标注为离线输入而非运行时依赖。
4. 对 canonical 数据执行 stable-ID、记录数、Activity manifest、日历/列表和资源引用的逐项核对。
5. 归档后删除 P0 旧运行时表面。
6. 完成 P1 源数据迁移和完整探针后，再删除 `legacy/data`。
7. 最后重新运行边界审计、全量探针、JSON 校验、`node --check`、`git diff --check`，并进行一次真实 NG 浏览器启动验证。
