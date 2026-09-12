# NGL → CL2 全量替换迁移计划

**Goal：** 将当前 `ng` 分支中所有以 NGL/JSON 蓝图为 canonical source 的 Activity 运行时、蓝图加载器、验证器、开发编辑器和数据内容迁移为 CL2 文本，并在完成行为、存档、编辑器和发布验证后移除 NGL 蓝图运行时路径。

**Architecture：** CL2 文件是唯一的图定义来源。CL2 lexer/parser/validator 在 `core` 中把文本解析为运行时和编辑器共用的内存 Blueprint Graph；不会把 CL2 编译成第二份 canonical JSON。Activity Runner 直接执行解析后的 Graph，Activity Editor 读取/修改 Graph 和 CL2 文档模型，并通过 serializer 写回 `.CL2.txt`。Activity 的非图元数据必须与 CL2 图文本分离保存，避免把 `displayName`、队列、日期等内容塞进脚本语法。

**Tech Stack：** 原生 JavaScript ES modules、HTML/CSS、JSON metadata、Node `.mjs` deterministic probes、Python/Node 离线迁移工具、现有 localhost 开发写盘 API。

---

## 一、现状与必须遵守的边界

### 当前入口和依赖

- `core/engine-bootstrap.js:207-221` 通过 `ActivityDefinitionStore` 从 `data/activity-manifest.json` 加载 `data/activities/*.json`。
- `core/ActivityDefinitionStore.js` 在注册时调用 `validateBlueprint()`，保存的是 JSON blueprint。
- `core/ActivityValidator.js` 负责旧 JSON `connections` 兼容归一化、`nodes/next/inputs` 图验证和可达性检查。
- `core/ActivityRunner.js`、`core/ActivityExecutionService.js` 逐节点执行现有 Graph，并通过 value wire 懒求值。
- `dev/ActivityEditorModel.js` 以 normalized blueprint 作为唯一可变模型，`dev/ActivityEditorView.js` 当前下载/写盘的是 JSON。
- `dev/DeveloperMode.js` 和 `dev/ActivityListManagerModel.js` 负责编辑器入口、Activity 列表和磁盘写入。
- `docs/cl2-language.md` 明确规定 CL2 直接解析为 Blueprint Graph；当前文档状态仍是设计草案，不能在迁移完成前宣称运行时已经切换。

### 迁移后的硬性约束

1. canonical Activity 图文件使用 `data/activities/*.CL2.txt`，运行时不再加载 Activity blueprint JSON。
2. CL2 parser 的输出是内存 Graph，不是写回的第二份 canonical JSON。
3. `option<x>`、`default`、隐式 `default`、纯值表达式、`reusablevalue` 和 `@cl2.pos` 必须拥有同一份 parser、validator、serializer 契约。
4. 隐式 `default` 只能在目标等于 CL2 源文件声明顺序中的下一个流程节点时使用；否则 serializer 必须写出显式 `default target;`，不能为了缩短文本改变行为。
5. `framework:diceCheck` 的流程端口契约固定为：`largeSuccess → option<1>`、`success → option<2>`、`failure → option<3>`、`largeFailure → default`，并由注册表声明而不是在 Runner 中写业务特判。
6. 所有旧 JSON 图来源都必须盘点：Activity 文件、窗口/Widget lifecycle inline blueprints、`BuiltinIconBlueprints.js`、自定义节点嵌套 blueprint、结构/数据库定义中的 use blueprint，以及任何 probe fixture。
7. 迁移期可以保留只读 JSON adapter 作为离线对照和回滚工具；最终发布运行时和编辑器不得依赖 NGL JSON loader、旧 JSON editor export 或旧连接格式。
8. 游戏行为仍按 `game → framework → core` 分层；CL2 parser/runtime 属于 core 通用能力，不能把患者、SAN、日期、NPC 或剧情判断硬编码进 CL2 parser/Runner。
9. 蓝图节点按引脚类型组合严格划分为四类；不存在第五类节点。流程输入引脚与数值输出引脚不能同时存在。
   - **流程节点：** 有流程输入；可有流程输出和数值输入；没有数值输出。
   - **数值节点：** 有数值输出；可有数值输入；没有流程输入和流程输出。
   - **流程起始节点：** 没有流程输入和数值输出；有流程输出；可有数值输入。
   - **数值接收节点：** 没有流程输入、数值输出和流程输出；有数值输入。
10. CL2 的 `reusablevalue` 表示可复用的数值产生式；第 4 类数值接收节点必须使用 `inputvalue` 语句表达其输入绑定，例如 `inputvalue a1: math['gte', getlocalvar[1], 4];`。`inputvalue` 不产生流程边，也不能被当作流程节点或数值节点执行。

---

## 二、目标数据契约

### CL2 文档模型

实现一个带源码位置信息的 CL2 Document/Graph 模型，至少包括：

```text
Cl2Document
  sourcePath
  reusableValues[]
  flowNodes[]                 // 保留声明顺序
  notes[]
  comments/trivia             // 若 serializer 支持保留
  diagnostics[]
  graph                       // Runtime/Editor 共用 Blueprint Graph

BlueprintGraph
  startNodeId
  nodes[nodeId]
    id
    type
    inputs[port]               // literal 或 ValueRef
    next[flowPort]             // { nodeId, port }
    x/y
  sourceLocation              // node/edge/value 的 line/column
```

Graph 字段可以沿用当前 Runner 所需的 `nodes/startNodeId/next/inputs` 形状，但必须由 CL2 parser 在内存中产生；不能把它重新写成 Activity JSON。

### 四类节点的统一分类契约

parser、validator、serializer、Runner 和编辑器必须共享同一个 `classifyNodePins(nodeDefinition)` 结果，而不能各自根据节点名称推断类别。分类前先检查互斥条件：只要同时出现流程输入引脚和数值输出引脚，立即报告非法节点；随后按以下完整判定表分类：

| 类别 | 流程输入 | 流程输出 | 数值输入 | 数值输出 | CL2 表达 |
| --- | --- | --- | --- | --- | --- |
| 流程节点 | 有 | 有或无 | 有或无 | 无 | 流程语句/流程调用 |
| 数值节点 | 无 | 无 | 有或无 | 有 | `reusablevalue` 或值表达式 |
| 流程起始节点 | 无 | 有 | 有或无 | 无 | 流程入口语句 |
| 数值接收节点 | 无 | 无 | 有 | 无 | `inputvalue name: value-expression;` |

验证器必须拒绝不属于这四类的节点。特别是“无任何引脚”“只有流程输入和数值输出”“只有流程输入但同时声明数值输出”等组合必须产生稳定错误码。`inputvalue` 的左侧名称必须绑定到对应数值接收节点的 stable ID/输入槽；右侧表达式必须通过普通 value parser 和注册表校验。

### Activity 非图元数据

在迁移前对所有 Activity JSON 顶层字段做机器化盘点，区分：

- 图数据：`blueprint` 内的节点、值边、流程边、位置、局部变量声明等，迁入 CL2。
- Activity metadata：`id`、`displayName`、`type`、`queueId`、`day`、`name`、`achievementId` 等，迁入 manifest/metadata 数据。
- 迁移工具专用或历史字段：保留在离线 preservation mirror，不进入运行时。

推荐目标：

- `data/activity-manifest.json` 保留 `id`、`file`、运行时所需的稳定 metadata。
- 若字段过多，新增 `data/activity-metadata.json`，以 Activity stable ID 为 key；`activity-manifest.json` 只负责文件注册和入口顺序。
- `ActivityDefinitionStore` 合并 metadata 与解析后的 CL2 Graph，返回现有 Activity definition API，避免队列、Availability、窗口调用方同时改写成多套 metadata 读取方式。

### 节点和端口注册

扩展 `core/ActivityNodeRegistry.js` 的注册契约：

- 流程函数 ID、输入值端口及类型、输出端口、是否有 `default`、终止性、副作用/权限。
- 纯函数 ID、输入参数、返回类型、是否允许 query 状态和可复用值嵌套。
- 端口的 CL2 名称与现有运行时 port name 的显式映射。
- dice/random/choice 等动态或多出口节点的完整有限端口集合。

不要在 parser 中写 `framework:diceCheck` 等业务端口特判；注册表应声明 `largeSuccess/success/failure/largeFailure` 到 CL2 分支编号及默认出口的映射。

---

## 三、分阶段实施任务

### Task 1：建立全量图来源与行为基线

**Objective：** 在任何 canonical 数据替换前，记录完整来源、稳定 ID、节点类型、端口、metadata 和运行时引用。

**Files：**
- Create: `tools/migration/cl2-inventory.py` 或等价 `.mjs`
- Create: `tools/migration/cl2-migration-inventory.json`
- Inspect: `data/activities/`, `data/windows/`, `data/blueprint-nodes.framework.json`
- Inspect: `core/`, `dev/`, `probes/`, `data/**/*.json`

**Steps：**

1. 扫描所有 JSON 中的 `blueprint`、`events`、`onCreate`、`onDestroy`、`onClick`、`onChange`、`use` 和嵌套 blueprint。
2. 分别统计 source file、Activity ID、node type、flow input/output port、value input/output port、stable node ID、引用方和目标文件。
3. 对每个节点依据四类引脚组合分类，单独列出非法组合、空引脚组合和同时具有流程输入/数值输出的组合。
4. 记录当前 `node.next`/`inputs` 与旧 `connections` 的形状，记录所有隐式 successor 依赖及第 4 类数值接收节点的输入绑定。
5. 对每条 Activity 记录当前 `validateBlueprint` 结果、可达节点数、终止节点数和失败原因。
6. 保存清单，不修改 canonical 文件。

**验证：**

```bash
python3 tools/migration/cl2-inventory.py
python3 -m unittest tools/migration/test_cl2_inventory.py
python3 -c 'import json; json.load(open("tools/migration/cl2-migration-inventory.json", encoding="utf-8"))'
```

**完成条件：** source count、manifest count、待迁移图 count 和嵌套图 count 都有可复核数字；没有只按文件名推断的遗漏结论。

---

### Task 2：冻结并补齐 CL2 v1 语法契约

**Objective：** 在写 parser 前解决设计草案中会阻塞真实数据的语法和语义歧义。

**Files：**
- Modify: `docs/cl2-language.md`
- Create: `core/Cl2Token.js`
- Create: `core/Cl2Syntax.md`（若不希望继续扩张主文档）
- Test: `probes/cl2-parser-probe.mjs`

**必须明确的规则：**

1. 函数 ID 是否允许 `framework:diceCheck` 这样的冒号；若不允许，定义稳定转义语法，并保证 serializer 可还原原始 registered ID。
2. 字符串、数字、布尔、null、数组和对象字面量是否沿用 JSON literal；对象内部的 value wire 如何表达。
3. `reusablevalue a1: function[...]` 的命名空间、前向引用、循环依赖和输出端口规则。
4. flow node 的 `option<x>`、`default` 和 implicit default 的解析优先级。
5. 隐式 default 的下一个节点是“下一个流程节点”还是任意声明；建议明确为下一个 flow declaration，并让纯值声明不参与 successor 计算。
6. `option<1,3,5>` 和 `option<1...4>` 的 lexer/parser 展开时机。
7. `@cl2.pos`、`@cl2.note`、普通注释和未知注释的保存策略。
8. `inputvalue a1: math['gte', getlocalvar[1], 4];` 的完整语法：左侧接收节点 ID/输入槽、右侧 value expression、前向 reusable value 引用、重复绑定和未连接必填数值输入的规则。
9. 错误恢复：单个节点语法错误时保留后续可解析节点和原始诊断；非法引脚组合必须在 parser/validator 中以同一错误码报告。

**验证：** 为每条语法写 parser red probe，再实现 lexer/parser 后转绿；至少覆盖完整示例、隐式 default、dice 端口、四类节点的最小实例、`inputvalue`、纯值嵌套、循环、注释和错误行列号。

**完成条件：** `docs/cl2-language.md` 不再把这些关键规则留作未决假设；parser probe 能输出稳定 AST/Graph 和精确 source location。

---

### Task 3：实现 CL2 lexer、parser 和 serializer

**Objective：** 提供唯一的文本↔内存 Graph 转换层，且 serializer 能稳定往返。

**Files：**
- Create: `core/Cl2Lexer.js`
- Create: `core/Cl2Parser.js`
- Create: `core/Cl2Validator.js`
- Create: `core/Cl2Serializer.js`
- Create: `core/Cl2Document.js`
- Test: `probes/cl2-parser-probe.mjs`
- Test: `probes/cl2-roundtrip-probe.mjs`

**实施要点：**

1. lexer 产生 token、行、列、原始文本范围；不能用正则一次性吞掉整个文件。
2. parser 生成 Document 和 runtime Graph；流程函数不能嵌套在流程函数参数中，纯函数必须走 value AST。`inputvalue` 生成数值接收绑定，不生成可调度的 flow/value producer 节点。
3. 对显式 flow edge 直接建立 `next`；省略 default 时把下一个 flow declaration 解析为隐式 default，但在 Graph 中标记 `implicit: true`，避免 serializer 把隐式边误写成显式边。
4. `reusablevalue` 建立命名 value entry，执行拓扑排序和循环检测。
5. parser 解析 `inputvalue <node-or-slot>: <value-expression>;`，将右侧表达式连接到指定数值输入；不把它改写成 `reusablevalue`，以保留第 4 类节点的语义。
6. parser 解析 `@cl2.pos`、`@cl2.note`，保留 stable ID 和 source location。
7. validator 复用 `ActivityNodeRegistry` 的端口契约，但错误必须增加 `path:line:column`、node ID、port 名称和错误码；先执行四类节点分类，再验证各类允许的边。
8. serializer 默认使用隐式 default；只有显式边不是声明顺序下一个流程节点、或作者明确要求保留 explicit default 时，才输出 `default target;`。
9. serializer 对 node ID、registered function ID、string literal、object literal 和 `inputvalue` 左侧绑定使用稳定转义；重复 serialize 不得产生无意义 diff。

**验证命令：**

```bash
node --check core/Cl2Lexer.js
node --check core/Cl2Parser.js
node --check core/Cl2Validator.js
node --check core/Cl2Serializer.js
node probes/cl2-parser-probe.mjs
node probes/cl2-roundtrip-probe.mjs
```

**完成条件：** `parse(serialize(parse(source)))` 的 Graph、四类节点分类、端口、稳定 ID、位置、`inputvalue` 绑定和显式/隐式 default 语义一致；错误文件仍返回 partial document 和诊断。

---

### Task 4：把现有 NGL JSON 蓝图转换器升级为严格 CL2 migration tool

**Objective：** 将已有 `tools/migration/blueprint_to_cl2.py` 从导出脚本升级为全量、可审计、零遗漏的迁移工具。

**Files：**
- Modify: `tools/migration/blueprint_to_cl2.py`
- Modify: `tools/migration/test_blueprint_to_cl2.py`
- Create: `tools/migration/migrate_ngl_to_cl2.py`
- Create: `tools/migration/cl2-parity-report.json`
- Preserve: `tools/migration/cl2-output/` 作为中间结果，不直接宣称 canonical 已切换

**实施顺序：**

1. 先读取 preservation mirror，禁止在 source JSON 上原地转换。
2. 使用与运行时相同的 CL2 serializer/parser，而不是 Python 工具自行定义第二套语法。
3. 按四类节点契约转换 source node；流程输入/输出、数值输入/输出必须与注册表定义一致。
4. 处理当前已确认的 dice 映射：`largeSuccess → option<1>`、`success → option<2>`、`failure → option<3>`、`largeFailure → default`。
5. 对第 4 类数值接收节点生成 `inputvalue <stable-id-or-slot>: <value-expression>;`，不得错误地输出 `reusablevalue` 或制造虚假的 flow edge。
6. 对可安全省略的 default 使用隐式 default；如果目标不是下一个流程节点，保留显式 default。
7. 对每个 source node 建立 source ID → CL2 node ID 对照；不允许因显示名称、翻译文本或文件名变化而改 stable ID。
8. 对每个无法映射的 node、port、metadata、nested blueprint 输出 blocked diagnostic，不得生成看似可运行的半截文件。
9. 重新 parse 每个生成的 CL2，并与源 Graph 做结构比较：节点类别、节点数、stable ID、流程出口、值边、`inputvalue` 绑定、终止节点、位置、metadata 和可达性分别比较。
10. 只有 `blocked=0`、`parse errors=0`、结构差异已分类且行为 probe 通过，才允许进入 canonical replacement。

**验证：**

```bash
python3 tools/migration/migrate_ngl_to_cl2.py \
  --source-preserved data/migration-source \
  --output data/activities-cl2 \
  --report tools/migration/cl2-parity-report.json
node probes/cl2-migration-parity-probe.mjs
```

**完成条件：** source count = output count = manifest candidate count；所有 output 能被正式 parser 加载；报告区分 copied data、graph parity、runtime parity 和未验证项目。

---

### Task 5：将 ActivityDefinitionStore 和 manifest 切换到 CL2

**Objective：** 让生产 Activity loader 读取 CL2 文本和 metadata，不再通过 JSON blueprint loader 进入运行时。

**Files：**
- Modify: `core/ActivityDefinitionStore.js`
- Modify: `core/engine-bootstrap.js`
- Modify: `data/activity-manifest.json`
- Create/Modify: `data/activity-metadata.json`
- Create: `probes/cl2-activity-loader-probe.mjs`
- Modify: `probes/game-content-migration-probe.mjs`

**实施步骤：**

1. 给 `DataLoader` 增加按 UTF-8 文本读取 CL2 的明确方法；不要把 `.CL2.txt` 当 JSON 解析。
2. 为 manifest entry 增加 `file`、metadata 引用和可选 `cl2Version`；稳定 Activity ID 仍由 manifest/metadata 持有。
3. `ActivityDefinitionStore.loadManifest()` 读取 metadata 和 CL2 source，调用 `parseCl2()` + `validateCl2Graph()`，返回现有调用方可消费的 definition。
4. 对 parse/validate 错误拒绝注册，并报告文件、行列和 Activity ID；不能静默跳过文件。
5. 将 `engine-bootstrap.js` 的入口加载从 `activities/*.json` 切换到 CL2 manifest；清理仅服务 NGL JSON 的分支。
6. 确保 `enqueueActivity()` 的 `currentNodeId`、Activity availability、queue、event router 和 child Activity 仍使用同一稳定 node ID。

**验证：**

- CL2 manifest loader probe：完整 manifest 0 parse errors、0 validator errors。
- Activity runtime probe：default Activity、manager Activity、一个 text/choice Activity、一个 dice Activity 均可注册和执行。
- JSON runtime reference audit：生产 `core/`、`framework`、`game` loader 不再打开 `data/activities/*.json` blueprint。

---

### Task 6：让 ActivityRunner 直接执行 CL2 Graph

**Objective：** 保留现有副作用和存档语义，只替换 Graph 来源和 flow/value 解析边界。

**Files：**
- Modify: `core/ActivityRunner.js`
- Modify: `core/ActivityExecutionService.js`
- Modify: `core/ActivityAvailabilityEvaluator.js`
- Modify: `core/ActivityQueue.js` / `core/ActivityInstance.js`（仅当恢复字段需要）
- Modify: `core/ActivityNodeRegistry.js`
- Create: `probes/cl2-runtime-probe.mjs`
- Modify: `probes/activity-runtime-probe.mjs`
- Modify: `probes/dialogue-node-probe.mjs`

**实施步骤：**

1. 将 Runner 的输入命名从 `definition.blueprint` 改成 `definition.graph` 或明确的 `definition.document.graph`，同时保留一个短期内部 adapter，避免 UI/queue 直接持有 JSON source。
2. 将 `nextFlow()` 改为消费 parser 解析出的 explicit/implicit successor；隐式 default 必须在 parser/Graph 构造时解析，Runner 不按字符串文件重新推断。
3. 将 `evaluateValueOutput()` 改为消费纯值 AST/Graph；数值接收节点的 `inputvalue` 绑定只在其所属节点执行前解析为输入值，不创建额外执行步骤。
4. Runner 启动前验证每个节点已经通过四类分类；流程调度只允许流程节点和流程起始节点，值求值只允许数值节点，数值接收节点只允许作为有数值输入的接收方。
5. 保持现有 stack cycle guard、`pvGateway`、`dbGateway`、`runtimeGateway` 和 nested custom node 语义。
6. 将 `MAX_STEPS`、pause/resume、wait、one-shot executedNodeIds、transcript、checkpoint、cancel、complete 保持不变，逐项增加 CL2 probe。
7. 对 `framework:diceCheck`、random branch、choice、range、switch 做边界/极值/缺少出口测试，确认 default fallback 与 CL2 端口契约一致。
8. 所有副作用仍通过现有 injected gateways；不得为了适配 CL2 在 Runner 增加 game-specific 分支。

**保存/恢复要求：**

- 存档只保存 Activity ID、queue ID、instance ID、currentNodeId、waiting state、local variables、executedNodeIds、transcript 和必要的 input payload，不保存整个 JSON/CL2 Graph。
- 版本化 save payload；恢复时先加载并验证 CL2 definition，再恢复 instance。
- 如果 CL2 文件缺少已保存的 node ID，恢复必须显式失败并报告迁移诊断，不能跳到下一个节点或按文本行号猜测。
- 为旧存档保留一次性 `saveVersion` adapter；adapter 只转换存档字段，不重新执行旧 NGL 蓝图。

**完成条件：** 现有 Activity runtime probe 全部通过，且至少覆盖四类节点、`inputvalue` 数值接收、初始节点、普通 action、choice、dice 四出口、value wire、pause/resume、save/restore、失败路径和循环退出。

---

### Task 7：将窗口/Widget/内嵌蓝图全部迁移到 CL2

**Objective：** 消除生产数据和内置代码中的剩余 JSON blueprint/NGL 图来源。

**Files：**
- Modify: `core/BuiltinIconBlueprints.js`
- Modify: `data/windows/*.json`
- Modify: `data/structures.framework.json`
- Modify: `data/blueprint-nodes.framework.json`
- Modify: `core/engine-bootstrap.js`
- Create: `data/inline-blueprints/*.CL2.txt` 或统一嵌入式 CL2 loader
- Create: `probes/cl2-inline-blueprint-probe.mjs`

**实施步骤：**

1. 使用 Task 1 inventory 列出每个 inline blueprint 的 owner、触发入口、输入 payload、输出/副作用和生命周期。
2. 将窗口和 Widget event blueprint 改为稳定 CL2 source reference，而不是 JSON 内嵌 `blueprint` object；source ID 由窗口/Widget stable ID 和 event name 组成。
3. `BuiltinIconBlueprints.js` 只保留通用 host registration 或改为 CL2 data definition；禁止继续构造 JSON graph 作为生产入口。
4. 自定义节点 nested blueprint 改为 CL2 document reference，并在注册时解析/验证；不得在 core parser 中写具体 game semantics。
5. 确认 lifecycle 顺序仍是 widget create → window create、widget destroy → window destroy，且 receiver 注册时序不变。
6. 修改 `runInlineBlueprint()` 使用 CL2 document/graph，而不是 `validateBlueprint(blueprint)`。

**验证：**

- `cl2-inline-blueprint-probe.mjs` 覆盖 window onCreate、widget onClick/onChange、desktop icon、custom value node。
- 搜索生产树中的 `blueprint: {`、`connections`、`validateBlueprint(`、`data/activities/*.json` loader，并逐项分类为已移除、离线工具保留或测试 fixture。
- browser verification：实际打开 settings/HIS/dialogue/window lifecycle 入口，观察按钮、文本、choice 和窗口创建/关闭行为。

---

### Task 8：把开发蓝图编辑器改成 CL2 source editor + Graph editor

**Objective：** Activity Editor 直接加载、编辑和写回 `.CL2.txt`，不再下载/写盘 JSON blueprint。

**Files：**
- Modify: `dev/ActivityEditorModel.js`
- Modify: `dev/ActivityEditorView.js`
- Modify: `dev/ActivityListManagerModel.js`
- Modify: `dev/DeveloperMode.js`
- Modify: `dev/devApi.js`
- Create: `dev/Cl2SourcePanel.js` 或等价 source diagnostics view
- Modify: `data/activity-manifest.json` / metadata editor
- Modify: `probes/activity-editor-probe.mjs`
- Create: `probes/cl2-editor-roundtrip-probe.mjs`

**编辑器模型：**

1. `createActivityEditorModel()` 输入 `Cl2Document`/Graph，不再输入 JSON blueprint。
2. 节点拖动、连线、添加/删除节点、value wire、复制粘贴、自动排布和 undo/redo 都修改 Graph，并标记对应 AST/document dirty。
3. 保存前通过同一 `Cl2Validator` 验证；错误显示 source line/column、node ID、port 和诊断码。
4. `download` 生成 `activity-id.CL2.txt`；`write-disk` 只允许写入 manifest allowlist 的 CL2 file，并在写盘后重新读取、parse、compare stable ID/Graph，再显示成功。
5. 对隐式 default 做保护：移动节点顺序可能改变语义，编辑器必须在 reorder/serializer 时将受影响的 implicit successor 显示为 warning，或自动升格为 explicit default 后要求用户确认。
6. inspector 编辑的是 node ID、registered node type、输入值、端口和位置；不得显示过时 JSON `connections` 编辑入口。
7. source panel 显示 CL2 原文和 parser diagnostics；Graph 视图与 source view 必须来自同一 document，不维护第二份 draft。
8. 多窗口实例继续隔离 root DOM、selection、history、source document、save callbacks 和 dirty state。

**验证：**

- 读取真实 `.CL2.txt`，打开 Graph，移动节点、改输入、连线、保存，再重新读取并比较 Graph。
- malformed CL2 显示 partial nodes 和行列错误，不清空整个编辑器。
- 两个编辑器窗口分别编辑两个 CL2 文件，互不覆盖状态。
- 浏览器实际打开 `?dev`，执行 load → edit → validate → save-to-memory → download/write-disk → reload。

---

### Task 9：迁移保存、调试器、列表和所有编辑器边界

**Objective：** 让开发调试工具和运行时存档完全以 CL2 definition + runtime instance 为边界。

**Files：**
- Modify: `dev/ActivityDebuggerView.js`
- Modify: `dev/ActivityDebuggerModel.js`（如存在）
- Modify: `dev/ActivityListManagerModel.js`
- Modify: `core/SaveManager.js` / save version owner
- Modify: `core/ActivityDefinitionStore.js`
- Modify: `probes/activity-debugger-runtime-probe.mjs`
- Create: `probes/cl2-save-restore-probe.mjs`

**规则：**

1. Activity Debugger 通过运行时 API 修改 node、currentNodeId、localVariables、queue 和 instance 状态，不直接改 parser internals 或隐藏 Map。
2. 保存调试器只能改 save/runtime state；CL2 source 编辑器才写 canonical content。
3. 数据库编辑器继续写 canonical database，不得把 CL2 metadata 或 graph 混入存档。
4. 调试器显示 CL2 source line/node ID 与 Graph node ID 的映射，断点和当前节点不使用文本行号作为持久化 ID。
5. 存档恢复后从当前 CL2 manifest 解析 definition，再恢复 instance；测试 source 更新、缺失 node、旧 saveVersion 和恢复失败 rollback。

---

### Task 10：双读对照、全量运行时 parity 和发布切换

**Objective：** 在移除 NGL 前证明 CL2 在结构、运行时、副作用、持久化和 UI 入口上等价。

**Files：**
- Create: `probes/cl2-ngl-shadow-parity-probe.mjs`
- Create: `probes/cl2-corpus-runtime-probe.mjs`
- Modify: `tools/verify-publish.js`
- Modify: `tools/publish.js`
- Modify: `AGENTS.md`
- Modify: `agent-notes.md`
- Modify: `README.md`
- Modify: `docs/cl2-language.md`

**对照阶段：**

1. 在离线 probe 中同时读取 preservation NGL JSON 和 CL2，分别构造 Graph；生产运行时只执行 CL2，不在玩家路径双执行副作用。
2. 比较 stable node IDs、flow edges、value edges、implicit/explicit default、位置、terminal paths、custom node inputs 和 metadata。
3. 用确定性 gateway/RNG 执行代表性 corpus：achievement、manager、text、choice、dice/random、medical、social、ending、window lifecycle、BGM、database action。
4. 比较事件序列、时间消耗、变量/资源变化、队列追加、transcript、window/display 结果和 save snapshot。
5. 对每个差异分类：转换 bug、原 JSON 无效、CL2 语义未覆盖、预期行为修订；不能以“数量相同”作为 parity 结论。

**发布切换：**

- `tools/publish.js` 复制 CL2 source 和 metadata，排除 migration mirror、conversion reports、editor source diagnostics 和旧 NGL JSON。
- `tools/verify-publish.js` 检查发布产物不含 `data/activities/*.json`、旧 NGL loader、`connections` 兼容 adapter、`validateBlueprint` 生产调用、`DEV-TOOLS`、`DeveloperMode` 和 migration-only paths。
- 只有完整 CL2 loader/parser/validator/runtime/editor 已通过后，才删除 production JSON loading；离线 preservation mirror 可暂时保留并明确不进入发布包。
- 发布入口启动、默认 Activity、窗口/Widget 事件、保存/恢复和代表性剧情必须用真实浏览器验证，不能用静态检查代替。

---

### Task 11：移除 NGL 生产路径并完成文档/工具退役

**Objective：** 确认 CL2 成为唯一生产图语言，并删除不会再被运行时调用的 NGL 图路径。

**Files：**
- Delete/retire only after audit: JSON blueprint loader compatibility branches, obsolete JSON editor export paths, old NGL normalization code
- Modify: `core/ActivityValidator.js`（改为 CL2 Graph validator 或仅保留非图数据校验）
- Modify: `core/ActivityDefinitionStore.js`
- Modify: `dev/ActivityEditor*`
- Modify: `tools/migration/*`（保留离线 source preservation/conversion，不保留生产 import）
- Modify: `AGENTS.md`, `agent-notes.md`, `README.md`, `docs/cl2-language.md`

**退役前审计：**

1. `git grep`/静态 import audit 证明生产 `core/`, `dev/`、实际 bootstrap 不再加载 NGL JSON blueprint。
2. 所有 `probes/` 逐项迁移到 CL2 fixture；禁止删除 probe 来获得绿色结果。
3. 清理旧 JSON 兼容字段、`connections` flattening、JSON 下载按钮和旧文件扩展名判断。
4. 保留离线 migration tool 只为历史 source 对照，并在文档中标注不能由运行时导入。
5. 更新 CL2 文档状态：从“设计草案/当前运行时 NGL”改为“生产语言”，但只在发布、浏览器、存档和全量 parity gate 都通过后进行。

---

## 四、验收矩阵

### 结构与语言

- [ ] 所有 CL2 文件 lexer/parser 可加载。
- [ ] 所有 node ID 唯一、稳定且无显示文本派生。
- [ ] 每个节点都能按四类引脚契约分类；非法组合和流程输入/数值输出共存均被拒绝。
- [ ] 注册 node type、流程输入/输出端口、数值输入/输出端口、value 类型均通过 validator。
- [ ] `option<x>`、`default`、隐式 default、dice 四出口、未连接 branch fallback 均有测试。
- [ ] `inputvalue` 可表达第 4 类数值接收节点，绑定对象、输入槽、右侧 value expression 和重复绑定错误均有测试。
- [ ] reusable value 无循环依赖，纯函数不产生副作用。
- [ ] 不可达节点、无限环、无终止出口和缺失目标都报告 source location。
- [ ] serializer 往返不丢位置、notes、stable IDs 和有效注释。

### 运行时

- [ ] ActivityDefinitionStore 只从 manifest + CL2 source + metadata 注册定义。
- [ ] Runner 的 flow/value 执行由 CL2 Graph 驱动。
- [ ] Runner 不把数值接收节点调度为流程或数值 producer；`inputvalue` 在所属节点执行前提供输入值。
- [ ] pause/resume/cancel/complete/wait/transcript/one-shot guard 行为不变。
- [ ] 时间、队列、事件、窗口、数据库、BGM、public variable 和 runtime collection gateway 逐类验证。
- [ ] save/restore 只保存 instance state，不保存 NGL/JSON blueprint。
- [ ] 旧 saveVersion 明确兼容或明确拒绝，不能静默恢复到错误节点。

### 编辑器与开发工具

- [ ] Activity Editor 读取 `.CL2.txt`，不读取 Activity JSON blueprint。
- [ ] 图编辑和 source 编辑共享同一 Document/Graph，没有双份 canonical draft。
- [ ] save-to-memory、download、write-disk 明确分离。
- [ ] 写盘后 readback + parse + Graph 比较通过。
- [ ] malformed CL2 保留 partial document 和 diagnostics。
- [ ] 多窗口 editor/debugger 状态隔离。
- [ ] Activity debugger、database editor、save debugger 的边界不混淆。

### 发布和浏览器

- [ ] `node tools/verify-publish.js` 通过。
- [ ] 发布目录无 NGL Activity JSON、旧 loader、开发工具和 migration-only source。
- [ ] 全量 JSON/metadata 校验、所有 changed JS `node --check`、`git diff --check` 通过。
- [ ] 完整 deterministic probes 通过并报告总数/失败数。
- [ ] 使用项目实际开发服务器和 `?dev` 入口完成真实浏览器操作验证。
- [ ] 玩家入口、默认 Activity、窗口事件、对话选择、dice 分支、存档恢复至少各有一条浏览器证据。

---

## 五、主要风险与处理策略

| 风险 | 影响 | 处理 |
| --- | --- | --- |
| 隐式 default 依赖声明顺序 | 编辑器排序可能改变剧情 | parser 标记 implicit edge；serializer 仅在目标为下一个 flow node 时省略；重排时 warning/显式升格 |
| `framework:` 等函数 ID 不符合初版 lexer | 全量文件无法解析 | 在 Task 2 冻结转义规则；注册表和 serializer 使用稳定 ID 映射 |
| JSON blueprint 顶层 metadata 无处存放 | Activity 调度/Availability 丢字段 | 先做字段 inventory，再用 manifest/metadata sidecar；禁止混入 CL2 图语法 |
| 自定义节点和 nested blueprint 未盘点 | 运行时入口仍偷偷依赖 NGL | Task 1 全量递归扫描；Task 7 单独迁移 inline/custom graph |
| 纯值节点顺序和 flow 节点顺序混淆 | 隐式后继错误 | CL2 明确“下一个流程节点”；value declaration 不参与 implicit successor |
| source line 与 stable node ID 混用 | 存档恢复和断点失效 | currentNodeId/断点永远使用 stable node ID；行列仅用于诊断/UI |
| parser 与 editor/runner 各自实现语法 | 同一 CL2 在不同路径含义不同 | parser、validator、serializer、editor 和 runtime 共用 `Cl2Document/Graph` 契约 |
| 迁移数量相等但行为不等价 | 错误地宣布完成 | 要求事件序列、状态、时间、副作用、save/restore 和浏览器 parity，不只统计文件数 |
| 兼容 adapter 留在生产路径 | NGL 没有真正退役 | 最终发布扫描旧 loader、JSON extension、旧 validator 和 source references，明确离线工具例外 |
| 迁移期间工作区已有未提交改动 | 误覆盖用户现有成果 | 执行前重新记录 `git status --short`，迁移提交与当前 `tools/migration` 改动分开；不重写、删除或恢复无关改动 |

---

## 六、建议提交/交付顺序

1. `feat(cl2): freeze v1 syntax and graph contract`
2. `feat(cl2): add parser validator and serializer`
3. `feat(migration): add full ngl to cl2 parity converter`
4. `feat(runtime): load activities from cl2 manifest`
5. `feat(runtime): execute cl2 graph through activity runner`
6. `feat(migration): convert inline and nested blueprints`
7. `feat(dev): edit and persist cl2 activity sources`
8. `test(cl2): add corpus runtime save and browser parity probes`
9. `refactor(runtime): remove ngl production blueprint path`
10. `docs(cl2): mark cl2 as production blueprint language`

每个提交都应独立运行相关 probe；在最终提交前运行完整验证矩阵、发布验证和真实浏览器验证。除非用户另行要求，不应在迁移中途删除 preservation mirror 或重写历史。
