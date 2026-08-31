# 自定义窗口管理器与可替代 HIS 实施计划

## 目标与边界

通过开发人员模式创建、编辑、保存和运行数据驱动的自定义窗口。窗口清单使用语言目录下的 `applist.json`，单窗口使用 `app_<id>.json`。窗口编辑器负责布局/部件属性，蓝图编辑必须复用现有 `DevDialogueEditorTab`，不能复制节点画布、端口编辑、拖拽或校验代码。

## 已实施的第一阶段

- 开发模式增加“自定义窗口管理器”入口
- `applist.json` 读取、列表展示、加号新建、减号移除、双击打开
- 新建窗口自动生成 `app_<id>.json` 草稿
- 窗口布局编辑器：部件添加、删除、选择、Ctrl/⌘ 累计选择/反选、属性编辑、画布拖动
- 部件事件字段：`onClick`、`onChange`、`onSubmit`、`onSelect`
- 独立 `CustomWindowSchema.js`：窗口尺寸、部件类型、ID、几何字段和事件引用校验
- 蓝图事件编辑：直接创建 `DevDialogueEditorTab`，通过 `embeddedScope.onSave` 回写指定部件事件，不复制蓝图编辑器
- 列表和窗口文件分别支持内存保存、下载和开发服务器写盘
- 运行时 `CustomWindowApp.js`：从清单加载窗口、渲染基础部件、将事件蓝图交给 `ActivityExecutionService`/`mainQueue`

## 第二阶段：稳定数据契约

1. 固定 `applist.json` schema：`[{id,title,icon,file}]`，禁止重复 id/file，file 必须匹配 `app_<id>.json`。
2. 固定窗口 schema：`version,id,title,icon,width,height,background,widgets,blueprints`。
3. 固定部件 schema：稳定 `id`、类型、x/y/width/height、显示属性、事件蓝图引用。
4. 将通用 blueprint 校验保持在 `ActivityBlueprint.js`，将窗口/部件校验保持在 `CustomWindowSchema.js`；两者只通过事件引用和蓝图数据边界连接。
5. 开发服务器增加受控删除能力（仅允许 `app_*.json`，禁止路径穿越），删除清单项时提供“仅移出列表 / 同时删除文件”明确语义。
6. 为未知字段制定保留策略：窗口编辑器读写时保留未知顶层字段和部件字段，不静默丢失。

## 第三阶段：编辑器能力完善

1. 增加窗口属性：背景、最小尺寸、默认位置、是否单实例、可调整大小。
2. 增加部件类型：容器、列表、表格、图片、标签、输入框、数字输入、下拉框、复选框、按钮、分页/选项卡。
3. 添加层级树、容器嵌套、对齐/分布、网格吸附、复制/粘贴、撤销/重做。
4. 将事件绑定按部件能力过滤：按钮显示 `onClick`，输入框显示 `onChange`/`onSubmit`，下拉框显示 `onChange`/`onSelect`，避免无效事件引用。
5. 蓝图窗口生命周期按实例隔离：每个窗口保存自己的 child editor、AbortController、回写回调，关闭父窗口时卸载 child。
6. 将窗口编辑器中的“事件蓝图”入口全部指向 `DevDialogueEditorTab` 的共享 API；未来如需通用化，扩展其 `embeddedScope`/validator option，而不是复制实现。

## 第四阶段：通用运行时与蓝图节点

1. 增加自定义窗口运行时实例状态：控件值、选中项、列表数据、可见性、启用状态，明确哪些进入存档、哪些是临时 UI 状态。
2. 增加 display receiver 目标 `custom-window:<appId>`，让 `text`/image 节点通过 receiver 更新窗口，而不是让 runner 依赖具体 app。
3. 增加通用 UI 蓝图节点（全部注册到 `ActivityNodeRegistry`，同步实现 validator、editor、runner/evaluator）：
   - `uiGetValue`：读取控件值
   - `uiSetValue`：设置控件值
   - `uiSetVisible`：显示/隐藏控件
   - `uiSetEnabled`：启用/禁用控件
   - `uiSetText`：修改标签/按钮文本
   - `uiSetOptions`：设置下拉框/列表选项
   - `uiAppendListItem` / `uiClearList`：列表数据操作
   - `uiOpenWindow` / `uiCloseWindow`：受控窗口导航
   - `uiNotify`：非阻塞提示
4. UI 节点只改变 presentation/runtime owner，不直接推进游戏时间；涉及游戏状态、物品、公共变量、医疗提交的操作必须使用既有 effect executor 和活动执行服务。
5. 为事件实例定义输入上下文：`appId`、`widgetId`、`eventName`、`value`、`checked`、`selectedIndex`，通过显式 value edge 进入蓝图，禁止读取 DOM 全局状态。

## 第五阶段：HIS 等效适配

1. 先审计 `HISApp.js` 的完整功能矩阵：病人列表、医疗事件、对话逐行继续、关键词收集、诊断选择、处方选择、提交、成功/失败、队列完成、时间推进、事件通知和恢复。
2. 把 HIS 所需数据访问能力暴露为通用蓝图节点或受控 domain service：
   - `hisGetPatients`
   - `hisGetMedicalIncidents`
   - `hisSelectPatient`
   - `hisGetDiagnosisOptions`
   - `hisGetMedicineOptions`
   - `hisSubmitCase`
   - `hisRenderDialogue`（优先改为 display receiver + 普通 text/choice 节点）
3. 节点必须调用现有 `medicalCaseManager`、`activityExecutionService`、`workQueue`、`keywordManager` 和 `TimeService`，不在自定义窗口中复制 HIS 业务逻辑。
4. 将 HIS 原型窗口改造成纯数据配置：布局、部件、事件蓝图和显示目标都来自 `app_his_custom.json`。
5. 逐项对比原 HIS 与自定义 HIS：相同输入、相同队列实例 ID、相同时间成本、相同关键词/公共变量/医疗结果/结束条件、相同存档恢复结果。
6. 通过功能开关选择替代入口，保留原 HIS 作为回归对照；全部验收通过后再移除旧入口，避免半成品替代生产路径。

## 第六阶段：验证与发布

- JS：所有触及模块执行 `node --check`
- 模块：真实 ESM import smoke test；Node 探针预置 `localStorage`，避免把环境噪声当成模块失败
- JSON：递归解析全部 `data/**/*.json`，检查清单引用文件存在、ID 唯一、蓝图引用存在
- 蓝图：节点类型、端口方向/类型、连接端点、控制节点、可达性、事件上下文输入
- 编辑器：新建/删除/双击、两窗口并行隔离、拖动、输入不丢焦点、蓝图回写、关闭卸载
- 运行时：每种部件事件至少一条成功路径和一条失败/无绑定路径；无事件蓝图不得产生队列实例
- HIS：患者/事件/诊断/处方/提交全路径，以及 20 分钟推进、16:00 边界、队列完成和存档恢复
- 发布：运行 `node publish.js`，确认 `publish/` 不含开发模式标记、`DeveloperMode`、`DevCustomWindow`、`dev-server.js`；确认 `CustomWindowApp` 和必要数据存在
- 最后运行 `git diff --check`，再按约定提交、推送、fetch/pull，比较本地与远端 SHA，确认工作区状态

## 当前明确未完成项

当前切片已经能编辑布局、绑定并打开共享蓝图编辑器、保存文件和运行基础控件；尚未声称“自定义 HIS 与原 HIS 完全等效”。等通用 UI 节点、HIS domain 节点、存档策略和逐项回归探针完成后，才可切换正式 HIS 入口。
