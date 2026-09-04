# cultists 新一代引擎重构计划

> 状态：已审批，本文仍只定义方案，不执行实现
>
> 目标目录：`ng/`
>
> 计划版本：v1.0
>
> 适用范围：从零设计新的 `cultists` 引擎，不承担旧引擎运行时兼容；旧游戏内容由后续 agents 按本计划改编
>
> 入口策略：开发期间直接在 `ng/` 中执行 `node dev-server.js`；`ng/` 成熟后整体移动到 project root，替代现有引擎并成为新的项目入口

---

## 1. 项目定位与边界

### 1.1 引擎名称与品牌

- 引擎名称：`cultists`
- 新引擎目录：`ng/`
- 引擎代码、引擎内置 schema、编辑器与通用运行时采用 2-Clause BSD（2BSD）协议
- 游戏《完蛋，我被邪教徒包围了！》的剧情、角色、图片、音频、数据与其他内容不自动纳入 2BSD
- 游戏内容授权声明必须与引擎授权声明分离，默认文案为：
  - 引擎：Copyright holder 许可下的 2-Clause BSD
  - 游戏内容：如有利用需要请联系开发者授权
- `ng/LICENSE` 或 `ng/NOTICE` 只声明引擎和工具的授权边界，不将 `data/` 中的游戏内容误声明为 BSD
- 发布脚本必须分别处理引擎文件与游戏内容文件，并在发布产物中保留清晰的授权说明
- 不新增未确认授权的字体或素材；编辑器和运行时默认使用系统无衬线字体或项目已确认可商用的开源字体

### 1.2 本阶段明确包含

1. 仿 Windows 95 的桌面外壳
   - 桌面
   - 图标
   - 窗口
   - 窗口标题栏
   - 最小化、最大化、关闭
   - 窗口拖动
   - 窗口大小调节
   - 窗口层级与焦点
   - 任务栏/窗口按钮
2. 仅开发版可见的开发人员模式
3. 基于蓝图的通用 Activity 系统
4. Activity 列表管理器与 Activity 可视化编辑器
5. 自定义窗口定义与 WYSIWYG 编辑器
6. 桌面图标管理器
7. 数据结构管理器
8. 公共变量管理器
9. 自定义数据编辑器生成机制
10. 通过数据结构和公共变量实现的物品、医疗等领域能力基础
11. 下班模式作为可配置的全屏自定义窗口
12. 存档系统

### 1.3 本阶段明确不包含

- 旧引擎运行时兼容
- 旧存档兼容或静默迁移
- 旧 UI 的像素级复刻
- 具体剧情、角色、医疗病例、物品内容的完整移植
- 在线多人、联网数据库、云存档
- 浏览器端任意路径写文件
- 将开发人员模式作为运行时安全边界；它只是构建时可移除的开发工具
- 在通用引擎内写死“物品”“医疗”“对话”等专用领域逻辑

---

## 2. 总体架构

### 2.1 目录规划

初步目录结构如下，具体文件名在实现阶段可因代码审查调整，但模块职责不可模糊：

```text
ng/
├── index.html
├── style.css
├── dev-server.js           # 在 ng/ 内直接启动，绑定 127.0.0.1
├── LICENSE                 # 仅引擎/工具 2BSD
├── NOTICE.md               # 引擎与游戏内容授权边界
├── README.md
├── engine.js               # ng 组成根
├── core/
│   ├── EventBus.js
│   ├── EngineState.js
│   ├── EngineBootstrap.js
│   ├── DataStore.js
│   ├── SchemaRegistry.js
│   ├── IdFactory.js
│   ├── Serialization.js
│   ├── PublicVariableManager.js
│   ├── DataStructureManager.js
│   ├── ActivityDefinitionStore.js
│   ├── ActivityQueue.js
│   ├── ActivityQueueRegistry.js
│   ├── ActivityInstance.js
│   ├── ActivityExecutionService.js
│   ├── ActivityRunner.js
│   ├── ActivityNodeRegistry.js
│   ├── ActivityValidator.js
│   ├── WindowDefinitionStore.js
│   ├── WindowManager.js
│   ├── WindowRuntime.js
│   ├── DesktopIconManager.js
│   ├── SaveManager.js
│   └── RuntimeRefResolver.js
├── editors/
│   ├── DeveloperMode.js
│   ├── ActivityListManager.js
│   ├── ActivityEditor.js
│   ├── CustomWindowEditor.js
│   ├── DesktopIconEditor.js
│   ├── DataStructureEditor.js
│   ├── GeneratedDataEditor.js
│   └── PublicVariableEditor.js
├── desktop/
│   ├── DesktopShell.js
│   ├── DesktopIcon.js
│   ├── Taskbar.js
│   ├── WindowFrame.js
│   └── PointerInteraction.js
├── data/
│   ├── engine.json
│   ├── activity-lists/default.json
│   ├── windows/*.json
│   ├── desktop-icons.json
│   ├── structures/*.json
│   ├── variables.json
│   ├── saves/.gitkeep
│   └── content/              # 后续由 agents 生成，不属于引擎协议
└── probes/
    ├── activity-probe.html
    ├── schema-probe.js
    ├── save-probe.js
    └── window-geometry-probe.js
```

`ng/` 使用原生 HTML、CSS 和 ES6 modules，不添加框架、构建系统或运行时依赖。开发期间工作目录就是 `ng/`，通过 `node dev-server.js` 启动并访问 `ng/index.html`；不要求从 project root 启动服务器。路径必须相对于 `ng/`，数据读取必须通过统一 `DataStore`，不在模块中散落 `fetch`。

`ng/` 是临时独立的新引擎入口，而不是最终永久子应用。成熟迁移阶段将 `ng/` 的引擎文件、数据和开发服务器移动到 project root，替代现有 `index.html`、`js/`、`css/`、`data/` 与开发入口；迁移前必须确认旧入口不再被需要，并重新执行完整发布和验证流程。

### 2.2 组成根与启动顺序

`engine.js` 作为唯一组成根，启动顺序固定为：

1. 判断当前 URL 是否为严格开发入口
2. 创建 `EventBus`
3. 创建 `SchemaRegistry` 并注册引擎内置 schema
4. 创建 `DataStore`，加载引擎配置和默认数据
5. 创建公共变量、数据结构、Activity、队列、窗口、图标和存档服务
6. 恢复存档；若没有存档，创建全新引擎状态
7. 先创建窗口/桌面基础设施，再激活 Activity 系统
8. 将唯一的 `default` Activity 列表中的 `default` 活动自动推入 `main` 主要队列
9. 执行 `default` 活动，完成用户自定义初始化
10. 若开发入口开启，挂载开发人员模式桌面图标与工具窗口
11. 发布 `engine:ready`

初始化过程分为 `loading`、`restoring`、`activating`、`ready` 四个状态。恢复失败必须释放所有恢复锁并显示明确错误，不得继续用半恢复状态启动 Activity。

### 2.3 全局状态所有权

| 状态 | 唯一 owner | 持久化 |
| --- | --- | --- |
| 引擎生命周期 | `EngineState` | 否 |
| 公共变量定义和值 | `PublicVariableManager` | 是 |
| 自定义结构定义 | `DataStructureManager` | 是 |
| Activity 定义 | `ActivityDefinitionStore` | 是/由数据文件管理 |
| Activity 实例 | `ActivityExecutionService` | 是 |
| Activity 队列 | `ActivityQueueRegistry` | 是 |
| 窗口定义 | `WindowDefinitionStore` | 是/由数据文件管理 |
| 打开的窗口及几何信息 | `WindowManager` | 是 |
| 桌面图标及顺序 | `DesktopIconManager` | 是/由数据文件管理 |
| 运行时可编辑数据库记录 | `DataStore` | 是 |
| 存档槽位 | `SaveManager` | 是 |

UI 只发命令或创建 Activity，不直接修改跨模块状态。模块间变化通过明确的事件名和 payload 传播。

---

## 3. 开发人员模式与可移除边界

### 3.1 包裹规则

所有仅开发版代码必须用明确标记包裹：

```text
// DEV-TOOLS:START
...
// DEV-TOOLS:END
```

HTML 使用 `<!-- DEV-TOOLS:START -->`，CSS 使用 `/* DEV-TOOLS:START */`。以下内容全部必须在标记内：

- 开发人员模式入口
- 开发人员模式样式
- Activity 编辑器
- Activity 列表管理器
- 自定义窗口编辑器
- 桌面图标管理器
- 数据结构管理器
- 自定义数据编辑器
- 公共变量管理器
- 开发探针入口
- 开发专用日志面板

通用运行时不能 import 开发编辑器模块。开发模式入口是唯一允许引用 `editors/` 的位置。

### 3.2 启用条件

初始实现采用严格查询串：只有 URL 完全为 `?dev` 时启用开发工具；普通查询串、额外参数或 hash 不自动启用。后续若改为构建注入，也必须保持源码标记可被发布脚本可靠删除。

开发模式不是权限系统。开发服务器若实现写盘功能，只绑定 `127.0.0.1`，并限制到 `ng/data/` 允许的文件名空间。

### 3.3 发布移除验收

发布脚本需要：

1. 移除所有 DEV-TOOLS 区块
2. 验证产物中不存在 `DeveloperMode`、编辑器入口和开发服务器模块
3. 验证发布版仍能加载默认运行时
4. 验证引擎 2BSD 文件与游戏内容授权声明仍存在
5. 扫描产物，若残留开发标记则失败而不是静默发布

---

## 4. Windows 95 桌面与窗口系统

### 4.1 桌面外壳

桌面外壳提供：

- 固定桌面根容器
- 图标层
- 窗口层
- 任务栏
- 时钟显示（显示引擎/游戏状态，不使用系统时间控制游戏逻辑）
- 普通窗口层；下班模式不属于桌面外壳的特殊模式

桌面是 presentation 层。打开窗口、拖动窗口、调整大小、改变焦点不推进游戏时间，不改变游戏阶段，不触发 Activity。任何需要推进时间的桌面图标行为都必须通过该图标绑定的内置 blueprint 执行，而不是由桌面或窗口代码直接改时间。

### 4.2 窗口生命周期

窗口实例必须有稳定 `windowInstanceId`，窗口定义使用稳定 `windowId`。生命周期：

```text
create -> mount -> focus/blur -> minimize/restore/maximize -> close -> destroy
```

每个窗口和组件支持可选内嵌 Activity blueprint：

- `onCreate`
- `onDestroy`
- 组件交互事件，如 `onClick`、`onChange`、`onSubmit`
- 需要时支持 `onFocus`、`onBlur`

生命周期 Activity 必须统一经过 `ActivityExecutionService`，不能由窗口自己创建另一套 Runner。销毁路径必须幂等，标题栏关闭、系统菜单关闭和程序化关闭只能执行一次 `onDestroy`。

实现现状：`onCreate`/`onDestroy` 在 `window-events` 队列执行（`engine.js` 的 `runWindowLifecycleEvent`）；组件的 `onClick`/`onChange`/`onFocus`/`onBlur` 在独立的 `widget-events` 队列执行（`runWidgetEvent`，通过 widget 树按 `widgetId` 查找），两条队列分开是为了调试器里不把窗口生命周期和高频组件交互事件混在一起。触发值（如 onChange 的新值）通过 `variableStore` 的约定变量名 `event:value` 传给蓝图，复用既有 `{variable}` 取值方式，未引入新节点类型。`onSubmit` 因渲染器尚无表单包装概念，暂不实现。

### 4.3 拖动与大小调节

- 标题栏拖动使用 Pointer Events
- 拖动状态按窗口实例隔离
- 使用 `setPointerCapture`，并在 `pointerup`、`pointercancel`、窗口卸载时清理
- 拖动过程中只更新现有 DOM 的位置和 draft，不重绘整个桌面
- 允许窗口越过桌面边界，但至少保留标题栏可恢复区域
- 调整大小使用 CSS `resize` 或显式 resize handle；最终几何数据回写 `WindowManager`
- 位置和大小全部使用同一坐标系，保存整数像素
- `x=0`、`y=0`、最小宽高等边界值使用 nullish 处理，不使用 `||` 丢失零值
- 窗口关闭后再打开时恢复上次几何；存档恢复必须在 launcher 注册完成后重开窗口

### 4.4 窗口焦点与任务栏

- `focus(windowInstanceId)` 递增 z-index
- 只允许一个 active window
- 任务栏按钮按实例显示；最小化窗口不销毁实例
- 快捷键和鼠标点击都调用同一个窗口 owner
- 开发工具多窗口同时打开时，每个编辑器实例拥有自己的 DOM 根、选中状态、draft 和回调

---

## 5. 通用 Activity 系统

### 5.1 概念分层

Activity 必须区分以下对象：

| 对象 | 作用 |
| --- | --- |
| Activity 定义 | 不可变或版本化的蓝图模板 |
| Activity 列表 | 按稳定 ID 组织多个 Activity 定义，支持时间加载 |
| Activity 实例 | 一次实际执行的 identity、输入、游标、状态和结果 |
| Activity 队列 | 按规则保存实例，维护阻塞、顺序和待执行项 |
| Runner | 执行单个实例的节点遍历与等待 |
| Execution Service | 统一创建、启动、暂停、恢复、取消、完成、恢复实例 |
| Effect Executor | 执行变量、数据库、队列、时间等副作用 |
| Presentation Receiver | 显示文本、图片、选择、窗口变化等展示副作用 |

核心代码不根据 `queueId` 或 `appId` 写死某个具体领域。所有 domain 行为通过注册的 effect/API 节点实现。

### 5.2 默认 Activity 列表

引擎内置且不可删除的列表只有：

```json
{
  "id": "default",
  "activities": [
    {
      "id": "default",
      "autoRun": true,
      "entry": "start"
    }
  ]
}
```

启动时严格执行：

1. 加载 `default` 列表
2. 解析 `default` 活动定义
3. 创建新的 Activity 实例
4. 推入 `main` 主要队列
5. 通过 `ActivityExecutionService` 执行
6. 只有成功执行后才发布 `engine:initialized`

`default` 活动负责初始化自定义公共变量、结构、数据库、图标、窗口或其他扩展。初始化操作应可重复执行，或者明确记录初始化版本，避免存档恢复后重复创建数据。

### 5.3 Blueprint 图模型

第一版采用有向图：

```json
{
  "id": "default",
  "name": "默认初始化",
  "version": 1,
  "nodes": [
    {
      "id": "start",
      "type": "start",
      "x": 80,
      "y": 60,
      "data": {}
    }
  ],
  "connections": [
    {"id":"edge-1","from":{"node":"start","port":"next"},"to":{"node":"end","port":"in"}}
  ]
}
```

每个节点类型通过 `ActivityNodeRegistry` 注册，声明：

- 输入端口与类型
- 输出端口与类型
- 配置 schema
- 是否可等待
- 是否有副作用
- 执行函数/API 名称

基础节点计划：

- `start`
- `end`
- `sequence`
- `branch`
- `switch`
- `loop`
- `delay`
- `blockUntil`
- `consumeTime`
- `setVariable`
- `getVariable`
- `createObject`
- `updateObject`
- `queryDatabase`
- `insertDatabase`
- `deleteDatabase`
- `enqueueActivity`
- `dequeueActivity`
- `callApi`
- `emitEvent`
- `showText`
- `showImage`
- `showChoice`
- `openWindow`
- `closeWindow`
- `return`

第一版不在通用节点内提供物品/病例专用节点；物品和医疗使用结构、变量、数据库和通用 API 节点组合。

### 5.4 blockUntil 与时间加载

`blockUntil` 是可持久化等待节点，不是 UI 定时器。它支持：

- 游戏绝对分钟
- 日期和时间条件
- EventBus 事件条件
- 公共变量条件
- 数据库查询条件

医疗病人对话的计划流：

```text
按时间加载病人数据
  -> 创建/更新病人自定义结构
  -> enqueue 对话 Activity
  -> Activity 到 blockUntil 节点
  -> 时间或事件满足
  -> 继续对话
```

等待期间必须保存：`instanceId`、`queueId`、活动版本、当前节点、局部变量、等待条件和恢复策略。刷新或读档后不得丢失等待状态，也不得重复触发已经完成的边。

### 5.5 队列

首批内置队列：

- `main`：主要队列，非领域专用
- 之后可由数据或蓝图注册自定义队列

队列定义包含：

- `queueId`
- `displayName`
- `mode`: `serial`、`parallel`、`blocking`
- `autoStart`
- `maxConcurrency`
- `entries`
- `activeInstanceIds`

队列管理器不能把工作、社交、医疗等领域写死。`ActivityQueueRegistry` 负责注册和恢复，领域政策仅订阅通用生命周期事件。

### 5.6 事件协议

初始事件名：

- `engine:loading`
- `engine:restoring`
- `engine:ready`
- `activity:created`
- `activity:queued`
- `activity:started`
- `activity:blocked`
- `activity:resumed`
- `activity:completed`
- `activity:failed`
- `activity:cancelled`
- `activity:changed`
- `queue:changed`
- `variable:changed`
- `database:changed`
- `window:changed`
- `desktop-icons:changed`
- `save:written`
- `save:loaded`

每个 Activity 事件都携带 `instanceId` 和 `queueId`；需要时携带 `definitionId`、`definitionVersion` 和 `cause`。事件名和 payload 由常量模块统一导出。

---

## 6. Activity 列表管理器与可视化编辑器

### 6.1 列表管理器

开发窗口“Activity 列表管理器”负责：

- 展示所有 Activity 列表
- 内置 `default` 列表置顶且不可删除
- 新建、复制、重命名自定义列表
- 打开列表内 Activity
- 新建、复制、删除 Activity
- 标记 Activity 是否按时间加载、是否自动运行
- 保存到内存
- 下载 JSON
- 通过本机开发 API 写入已存在数据文件
- 显示“从列表移除”和“删除文件”的区别

列表的左侧只显示当前列表文件和条目；未选中节点时，右侧编辑的是当前 Activity 的 `id`、`displayName` 和元数据，不是列表文件 ID。

### 6.2 Activity 编辑器

布局：

- 左：节点类型面板
- 中：无限或可平移画布
- 右：节点属性与端口 inspector
- 顶部：撤销、重做、校验、保存、导出、运行探针

交互要求：

- 点击选中节点
- Ctrl/Cmd 累计选择和反选
- 框选多节点
- 多节点同步拖动
- 重叠节点仍可可靠选中和拖动
- 连接只允许端口类型兼容
- 删除节点时清理相关连接
- 拖动过程中不重建 canvas
- 选择和拖动状态按编辑器实例隔离
- 画布缩放不改变逻辑坐标精度

编辑器保存的唯一 canonical model 是 `blueprint`。不得从旧的临时 tree 或 DOM 反向拼装图。导入旧形态（如未来 agents 产生）只能在导入边界规范化一次。

### 6.3 校验规则

保存前必须校验：

- 节点 ID 唯一
- 连接 ID 唯一
- from/to 节点存在
- from/to 端口存在
- 端口类型兼容
- 只有一个入口节点或显式入口集合
- 不存在不可达节点（允许标记为 draft 时例外）
- 必填配置完整
- `blockUntil`、`consumeTime` 等节点拥有合法输入
- 变量、结构、队列、窗口和 API 引用存在
- 循环节点拥有可退出路径或明确允许无限等待

---

## 7. 自定义窗口与 WYSIWYG 编辑器

### 7.1 窗口定义 schema

窗口定义至少包含：

```json
{
  "id": "off-duty",
  "title": "下班模式",
  "icon": "moon",
  "mode": "window",
  "fullscreen": false,
  "geometry": {"x": 120, "y": 80, "width": 640, "height": 420},
  "root": {
    "id": "root",
    "type": "container",
    "flow": "vertical",
    "gap": 8,
    "padding": 10,
    "children": []
  },
  "events": {"onCreate": null, "onDestroy": null}
}
```

运行时和编辑器必须消费同一个 layout contract。不能让编辑器用绝对定位预览、运行时再包成 flex/grid，导致 WYSIWYG 虚假一致。

### 7.2 组件类型

第一版组件：

- `container`
- `label`
- `button`
- `textInput`
- `textarea`
- `select`
- `checkbox`
- `image`
- `list`
- `table`
- `progress`
- `spacer`

通用属性：

- 稳定 `widgetId`
- 可见性条件
- enabled 条件
- 文本/数据绑定
- CSS class token
- 内嵌事件 blueprint 引用

容器属性：

- `flow`: `vertical`、`horizontal`、`grid`、`stack`
- `gap`
- `padding`
- `align`
- `justify`
- `wrap`
- `minSize`、`maxSize`

### 7.3 WYSIWYG 交互

- 编辑器画布直接使用运行时渲染器
- 组件可选中、移动、复制、删除
- 容器支持拖放改变父子关系
- inspector 编辑 flow、padding、gap、对齐方式和组件属性
- 可以切换“布局结构视图”和“运行预览”
- 拖动窗口/组件到哪里就保存到哪里
- 对 flex/grid 容器明确显示哪些 x/y 属性不生效，不能伪装成可编辑几何
- 输入框 text 事件只更新现有 inspector 值，不整体重绘导致失焦
- 动态列表保留当前值，增加/删除有边界限制
- 所有组件事件都创建 Activity，通过统一执行服务运行

> 实现状态（follow-up "组件可以拖动放置到任何位置，而不是只能拖动排序"）：预
> 览画布上的拖放操作总是把被拖组件自由定位到鼠标释放点，若目标容器当前不是
> `flow:"stack"` 会先自动切换为 `stack`（仅在编辑器里发生一次拖放手势时触
> 发，运行时/未编辑过的窗口定义不会自行改变声明的 flex/grid flow）。

### 7.4 全屏下班窗口

下班模式不需要专用的 `OffDutyMode` 运行时代码，也不需要独立覆盖层实现。它只是后续通过自定义窗口编辑器创建的普通窗口定义，并设置 `fullscreen: true`：

- 与其他自定义窗口使用完全相同的窗口实例、组件树、WYSIWYG layout contract 和生命周期
- `fullscreen: true` 只改变窗口运行时的几何和层级策略，由通用 `WindowManager` 处理
- 全屏窗口显示在桌面、普通窗口和任务栏之上，但仍然是一个普通 `windowId`/`windowInstanceId`
- 关闭、保存、恢复、多窗口上下文和 `onCreate`/`onDestroy` 与其他窗口完全相同
- 下班图标不调用专用下班函数；它绑定一个只负责 `openWindow` 的内置 blueprint
- 时间推进节点属于下班窗口定义自身的 `events.onCreate` blueprint，随窗口创建时通过 `ActivityExecutionService` 执行一次；打开窗口这个动作本身（`WindowManager.open`/桌面图标 blueprint 的 `openWindow` 节点）永远不推进时间
- 存档只保存普通窗口实例的 `windowId`、fullscreen 定义版本、打开状态和几何快照

示例行为流：

```text
桌面双击“下班”图标
  -> 创建图标绑定的内置 Activity blueprint 实例
  -> openWindow(windowId="off-duty")
  -> 完成图标 Activity（不推进时间）
窗口管理器发出 window:opened(windowId="off-duty")
  -> 引擎执行 off-duty 窗口定义自身的 events.onCreate blueprint
  -> consumeTime(480 或由 blueprint 输入指定的时间)
  -> 完成该内置生命周期 Activity
```

“下班模式”这个名称属于游戏内容/窗口定义，不进入通用引擎代码的领域分支。

---

## 8. 桌面图标管理器

### 8.1 图标 schema

```json
{
  "id": "his",
  "label": "HIS",
  "logo": {"kind":"emoji","value":"🏥"},
  "position": {"mode":"grid","order":3,"x":0,"y":0},
  "doubleClick": {
    "blueprintId":"desktop.open-window",
    "inputs":{"windowId":"his-window"}
  }
}
```

位置支持：

- 网格顺序
- 自由 x/y
- 自动排列
- 隐藏/显示

logo 支持：

- emoji/text
- 引擎内置图标
- 数据文件中的受许可图片资源

### 8.2 图标编辑器

- 拖动图标调整位置
- 选择图标顺序
- 更换 logo 和显示名
- 指定双击行为
- 双击只绑定一个稳定的 blueprint ID 和输入参数；不在图标数据中内联另一套执行器
- blueprint 可以通过通用节点打开窗口、打开全屏自定义窗口、推进时间、入队 Activity 或发出通用事件
- 下班图标绑定的 blueprint 通过 `desktop.run-activity` 运行专用的 `off-duty-open` Activity（只执行 `openWindow(windowId="off-duty")`）；`consumeTime` 属于下班窗口自身的 `events.onCreate`（见 §7.4），图标 blueprint 本身不包含 `consumeTime` 节点
- 图标行为参数通过 schema 校验
- 只通过稳定 `iconId`、`windowId`、`blueprintId` 引用
- 桌面与编辑器使用同一位置/布局渲染器

> 实现状态：`ng/dev/DesktopIconEditorView.js` 已实现（新建/删除/上移/下移/
> 改 label·glyph·position·blueprintId·inputs），直接操作与运行中桌面共享的
> `DesktopIconManager` 实例，每次编辑立即调用 `refreshIcons()` 预览，另有
> 「写入磁盘」按钮持久化到 `desktop-icons.json`。从开发人员模式启动器的
> 「桌面图标编辑器」入口打开。

### 8.3 内置图标 blueprint

引擎提供一组不可删除的通用桌面行为 blueprint，图标只引用其 ID，不直接调用窗口或时间 API。第一批包括：

- `desktop.open-window`
- `desktop.open-window-and-advance-time`
- `desktop.run-activity`
- `desktop.emit-event`

内置 blueprint 的节点仍然由通用 Activity Runner 执行。窗口 ID、时间分钟数和其他行为参数通过输入端口传入。游戏内容可以绑定内置 blueprint，也可以在允许的范围内创建自己的图标 blueprint，但桌面组件不根据图标名称猜测行为。

---

## 9. 数据结构管理器与自定义数据库

### 9.1 设计目标

物品、医疗、病人、病例、对话上下文等都不是引擎硬编码类型，而是由数据结构管理器定义的结构和数据库记录组成。

### 9.2 结构 schema

```json
{
  "id": "item",
  "displayName": "物品",
  "fields": [
    {"id":"name","type":"string","required":true},
    {"id":"quantity","type":"smallInteger","default":1},
    {"id":"tags","type":"array<string>","default":[]}
  ],
  "editor": {
    "layout":"form",
    "groups": []
  }
}
```

支持字段：

- `bool`
- `smallInteger`
- `integer`
- `real`
- `string`
- `objectRef`
- `array`
- 之后扩展 `enum`、`dateTime`、`map`

`objectRef` 必须指定目标对象域：活动实例、Activity 队列、自定义结构记录、公共变量或窗口实例。

### 9.3 数据库

数据库定义包含：

- `databaseId`
- `recordType`
- 唯一主键规则
- 索引
- 是否允许删除
- 记录集合
- 版本

通过蓝图 API 操作：

- `createRecord`
- `getRecord`
- `updateRecord`
- `deleteRecord`
- `findRecords`
- `countRecords`
- `transaction`

API 需要输入 schema 校验，返回值进入 Activity 局部变量或公共变量。不能在 UI 中直接改数据库绕过 API。

### 9.4 自定义数据开发编辑器

生成结构后，可以为该结构声明编辑器配置：

- 字段分组
- 字段顺序
- 控件类型
- label/help 文案
- 可见性条件
- 只读条件
- 表格列
- 记录筛选
- 默认新建值

运行时生成 `GeneratedDataEditor`，但生成器只生成配置，不生成重复 JS 文件。编辑器与运行时共享字段 schema、校验器和数据绑定器。

多窗口打开时，每个结构编辑器必须有实例级上下文，不能使用重复全局 DOM ID。

> 实现状态：`ng/dev/DataStructureEditorView.js`（结构 schema 增删字段）与
> `ng/dev/DatabaseDebuggerView.js`（运行时记录浏览/创建/编辑/删除，始终经
> `DataStore.createRecord/updateRecord/deleteRecord/findRecords/listDatabases`
> API）已实现，从开发人员模式启动器的「数据结构管理器」「数据库调试器」入口
> 打开。`editor` 分组/控件类型/可见性条件驱动的 `GeneratedDataEditor` 仍未
> 实现，当前数据库调试器对每条记录使用通用 JSON 文本框。

---

## 10. 公共变量管理器

### 10.1 类型与范围

公共变量 ID 范围扩展为 `0..65535`，ID 必须为非负整数且唯一。支持类型：

| 类型 | 范围/规则 |
| --- | --- |
| `bool` | `true` / `false` |
| `smallInteger` | `0..255` |
| `integer` | 由 schema 定义安全整数范围，默认使用 JS safe integer 子集 |
| `real` | 有限数值，不接受 NaN/Infinity，精度规则由定义声明 |
| `string` | UTF-16 字符串，长度可设上限 |
| `object` | 活动实例、活动队列、自定义数据结构等受注册引用 |

对象变量不直接保存循环对象。持久化时统一保存 `{objectType, objectId}` 引用，并在恢复后由 `RuntimeRefResolver` 解析。失效引用必须变成明确的 unresolved 状态，不静默指向其他对象。

### 10.2 变量定义与值分离

变量定义包含：

- `id`
- `name`
- `type`
- `defaultValue`
- `min`/`max`
- `persistent`
- `readOnly`
- `objectTarget`
- `description`

运行时值单独存储。所有变更通过 `PublicVariableManager.set()`、`increment()` 或对象引用 API 完成，统一发出 `variable:changed`。

### 10.3 条件与效果

通用条件支持：

- `eq`
- `neq`
- `gt`
- `gte`
- `lt`
- `lte`
- `all`
- `any`
- `not`
- 类型安全比较

通用效果支持：

- `set`
- `delta`（仅整数/实数）
- `toggle`（仅 bool）
- `append`/`remove`（数组或字符串由结构定义）
- `setObjectRef`

变量编辑器必须覆盖 ID 边界、重复 ID、类型变更、越界值、失效对象引用和存档恢复。

---

## 11. 物品与医疗的纯数据实现方案

### 11.1 物品管理器示例

不实现专用硬编码 `ItemManager` 作为状态 owner，而是通过以下数据声明：

1. 数据结构 `item`
2. 数据库 `inventoryItems`
3. 公共变量 `playerInventory`，类型为 object，目标为自定义数据结构集合或数据库句柄
4. 蓝图 API：查询、添加、移除、消耗、检查条件
5. 自定义物品编辑器配置

物品使用流程：

```text
点击物品
  -> 创建 use-item Activity 实例
  -> queryDatabase(inventoryItems)
  -> branch 条件
  -> callApi 消耗/修改记录
  -> consumeTime（若该物品定义要求）
  -> emitEvent item:used
```

UI 不直接修改库存，也不直接推进时间。

### 11.2 医疗系统示例

医疗数据拆分为结构和数据库：

- `patient`
- `medicalCase`
- `symptom`
- `diagnosis`
- `treatment`
- `patientDialogueContext`
- `medicalAppointments`

病人对话存储在单独 Activity 列表，不混入医疗结构。医疗 Activity 通过时间字段和 `blockUntil` 加载：

```text
读取 medicalAppointments
  -> blockUntil appointment.start
  -> 创建 patientDialogue Activity
  -> 执行对话节点
  -> blockUntil 下一时间或事件
  -> 更新 medicalCase 状态
```

所有病例状态变化都走数据库 API。医疗 UI 是自定义窗口，字段和列表由结构编辑器配置生成。

---

## 12. 存档系统

### 12.1 目标

新引擎不兼容旧存档，使用独立的版本化 envelope：

```json
{
  "format": "cultists-ng-save",
  "version": 1,
  "engineVersion": "0.1.0",
  "createdAtGameTime": 0,
  "state": {
    "variables": {},
    "databases": {},
    "activityInstances": {},
    "queues": {},
    "windows": {},
    "desktopIcons": {}
  }
}
```

`createdAtGameTime` 是游戏逻辑时间，不使用系统时间作为游戏状态。

### 12.2 存档范围

必须保存：

- 公共变量值
- 自定义数据库记录
- 自定义结构版本引用
- Activity 实例、当前节点、局部变量、等待条件、结果和错误
- Activity 队列 entries、active IDs、阻塞状态
- 窗口实例、几何、最大化/最小化、打开的定义 ID
- 桌面图标位置和顺序
- 下班模式是否打开
- 引擎初始化版本

定义文件本身由项目数据管理，不复制进每个存档；保存定义版本 hash 或版本号，加载时缺失/不兼容要报错。

### 12.3 保存与恢复安全

- 保存使用深拷贝快照，不保存活的 DOM、函数、循环对象或 Promise
- 对象变量保存稳定引用
- 恢复前停止当前 Runner
- 替换队列与实例 snapshot 后再恢复 Runner
- 恢复过程由 `try/finally` 释放 guard
- 恢复成功后只扫描一次待启动项
- 恢复失败不覆盖当前有效状态
- 使用显式保存按钮和下载文件，后续可接本地开发 API

---

## 13. 实施阶段

### Phase 0：方案冻结与测试基线

交付：

- 本计划审批
- schema 草案
- 事件协议草案
- 目录和模块依赖图
- 2BSD 与游戏内容授权边界说明
- 确认 `ng/` 是独立入口，不改旧 `index.html`

验收：文档通过审查，未写运行时代码。

### Phase 1：NG 桌面壳与窗口内核

交付：

- `ng/index.html`
- Win95 样式
- 桌面、图标占位、窗口层、任务栏
- WindowManager、窗口焦点、拖动、大小调节、最小化/最大化/关闭
- 窗口几何存储
- 一个最小自定义窗口示例

确定性探针：

- 创建两个窗口，焦点和 z-index 正确
- 拖动后 x/y 等于 pointer 结束位置
- 调整大小后宽高符合最小值
- 关闭/恢复不泄漏事件监听
- x/y 为 0 时仍能保存

### Phase 2：Activity 核心运行时

交付：

- Blueprint schema 与 validator
- Node registry
- ActivityInstance
- main queue 和 queue registry
- ExecutionService、Runner、等待节点
- EventBus 协议
- `default/default` 自动入主队列并执行

确定性探针：

- 新游戏自动创建并执行 default 实例
- 自定义 setVariable 初始化成功
- branch、loop、blockUntil、consumeTime 行为可恢复
- 失败/取消/重复完成只发一次终态事件
- 保存后恢复到等待节点并继续

### Phase 3：开发人员模式与 Activity 编辑器

交付：

- 严格 `?dev` 入口
- 开发工具图标/窗口
- Activity 列表管理器
- 可视化节点、端口、连接编辑
- 多选、多拖、重叠节点交互
- schema 校验、内存保存、下载、写盘边界

确定性探针：

- 两个 Activity 编辑器窗口互不串状态
- 图导出/重新加载保留节点、连接、位置和 presentation target
- 端口类型错误无法保存
- 下载内容与内存 draft 一致

### Phase 4：自定义窗口与 WYSIWYG

交付：

- window/widget schema
- 共享 runtime renderer 和 editor renderer
- 容器 flow、padding、gap、布局预览
- 组件增删、移动、复制、属性 inspector
- widget/window lifecycle blueprint
- 通过编辑器创建的全屏下班窗口示例（不新增下班专用运行时代码）

真实浏览器验收：

- 编辑器预览与运行窗口使用同一初始数据
- 对 root、主要容器和每个 widget 对比 DOM 层级、尺寸、padding、gap、overflow、visibility
- 编辑器拖动后 draft 坐标变化
- 保存、reload、重新打开后位置保持
- 全屏自定义窗口覆盖桌面并可返回，且与普通窗口共用生命周期

### Phase 5：桌面图标与数据结构

交付：

- 图标顺序、logo、自由位置
- 双击行为声明和 blueprint 路由
- 数据结构 schema、字段验证、数据库 API
- 自定义数据编辑器配置与生成器

确定性探针：

- 图标拖动/排序后保存恢复
- 双击只触发声明的窗口或 Activity
- 结构字段类型、默认值和 required 校验正确
- 数据库 CRUD 全部通过蓝图 API
- 两个生成编辑器实例互不共享选择状态

### Phase 6：公共变量与领域示例

交付：

- 0..65535 变量 ID
- bool、smallInteger、integer、real、string、object
- object reference resolver
- 条件/效果节点
- 物品结构、库存数据库、物品蓝图示例
- 医疗结构、病例数据库、预约和对话 Activity 列表示例

确定性探针：

- ID 0、65535 有效，65536 无效，负数无效
- smallInteger 越界拒绝
- NaN/Infinity 拒绝
- object 引用保存/恢复/失效可见
- 物品使用不绕过 Activity
- 医疗对话按 blockUntil 时间触发且不会重复触发

### Phase 7：存档与发布边界

交付：

- SaveManager
- 文件下载/选择加载
- 保存前 snapshot
- 恢复 barrier
- dev 发布移除脚本
- 2BSD/游戏内容 NOTICE

验收：

- 新建、保存、刷新、加载后状态一致
- 等待中的 Activity、窗口几何、数据库记录和 object reference 一致
- 错误存档不破坏当前状态
- 发布产物无 DEV-TOOLS、编辑器入口或 dev-server
- 引擎许可与游戏内容许可分离可审计

### Phase 8：旧内容 agents 改编接口

仅在前述阶段全部通过后开始：

- 为旧内容提供数据导入/人工改编规范
- 不把旧运行时 API 直接复制进 `ng/`
- 每个领域先建结构、数据库、Activity 列表和窗口定义
- 为每个迁移模块写行为矩阵与确定性探针
- 新旧游戏内容可在独立入口比较，但不要求旧存档可加载

### Phase 9：ng/ 成熟后的根目录替换

该阶段不是日常开发的一部分，只有新引擎和首批改编内容达到发布质量后执行：

1. 冻结旧引擎，确认不再需要旧 `index.html`、`js/`、`css/`、`data/` 和旧 `dev-server.js`
2. 记录 `ng/` 当前版本、数据 schema 版本、存档格式版本和发布探针结果
3. 将 `ng/` 内的入口、引擎模块、数据、开发人员模式和 `dev-server.js` 移动到 project root 的对应位置
4. 让 project root 直接由新的 `index.html` 成为游戏入口；开发期间在 project root 执行 `node dev-server.js`
5. 更新发布脚本、文档、许可证边界和 agents 协作说明
6. 删除旧引擎残留入口，禁止通过旧模块路径继续加载旧运行时
7. 重新运行所有 JS/JSON/schema/save/browser/publish 验证，不以移动前通过作为替代

验收：根目录启动的新入口与 `ng/` 成熟版本行为一致，旧入口不再存在，开发服务器和发布服务器路径均正确，且 git diff 中没有意外覆盖游戏内容授权声明。

---

## 14. 验证与质量门槛

每个阶段都必须执行：

1. `node --check` 检查每个修改过的 JS 文件
2. Python 递归校验 JSON
3. `git diff --check`
4. schema 探针
5. 相关模块的原生 ESM import smoke test
6. 需要 UI 时使用真实浏览器验证，不以静态 JSON 或截图替代行为证据
7. 发布阶段执行发布脚本并扫描开发标记

### 14.1 必须覆盖的失败路径

- 数据文件缺失
- schema 类型错误
- ID 重复
- Activity 节点引用不存在
- 端口类型不兼容
- 数据库记录不存在
- 变量类型不匹配
- object reference 无法解析
- Activity 执行异常
- Activity 取消和重复终态
- 队列恢复失败
- 存档版本不匹配
- 窗口定义缺失
- 编辑器窗口关闭时 blueprint 未保存
- 多编辑器实例状态串扰
- 发布脚本发现未包裹的开发代码

### 14.2 不变量清单

- 普通 UI 行为不会自动推进游戏时间
- 所有可见计时操作先创建 Activity
- Activity 只能由 ExecutionService 管理 Runner 生命周期
- 一个 Activity 实例只有一个终态
- 队列只保存稳定 instanceId，不保存重复活对象
- `default/default` 新游戏只自动推入一次
- `blockUntil` 跨刷新/读档可恢复
- 窗口的 presentation 状态不改变游戏领域状态；图标绑定的 blueprint 可以显式改变领域状态
- WYSIWYG 编辑器与运行时使用同一个布局 contract
- 开发工具可以完整移除而不破坏运行时
- 公共变量 object 类型只保存引用
- 物品和医疗不进入通用引擎硬编码分支
- 引擎 2BSD 授权与游戏内容授权不混淆

---

## 15. 风险与决策点

### 风险 A：WYSIWYG 与运行时布局分叉

措施：同一个 `WindowRuntimeRenderer` 接受 preview/runtime mode；只允许 presentation wrapper 不同，布局树和组件属性相同；用 browser geometry probe 验证。

### 风险 B：Activity 蓝图变成第二套业务逻辑

措施：Runner 只负责流程；变量、数据库、队列、窗口和领域效果全部从注入 API/Effect Executor 进入。

### 风险 C：对象公共变量造成循环引用或存档损坏

措施：运行时只使用稳定引用；保存前断言无裸对象；加载后 resolver 返回明确 unresolved 状态。

### 风险 D：开发工具残留在玩家版

措施：源码 marker、独立 import 边界、发布脚本扫描、发布后反向检查。

### 风险 E：编辑器多窗口互相覆盖

措施：禁止重复全局 ID；所有查询从实例根节点开始；所有 selection、draft、drag 和 callback 都在 editor instance 内。

### 风险 F：领域逻辑重新硬编码

措施：物品和医疗先写成结构/数据库/Activity 示例；代码审查禁止新增 `if (item)`、`if (medical)` 这类通用运行时专用分支。

### 风险 G：启动初始化重复执行

措施：保存 engine initialization version；`default/default` 具有幂等约束；启动和恢复分别有明确 barrier。

---

## 16. 审批结论与已冻结决策

以下事项均已确认，可以据此开始 Phase 1：

1. 接受 `ng/` 作为完全独立的新入口，不修改旧 `index.html`
2. 接受内置唯一 `default` Activity 列表及 `default/default` 自动入 `main` 队列
3. 接受 Activity、窗口组件生命周期统一走同一 `ExecutionService`
4. 接受物品/医疗不做专用核心模块，而用结构、数据库、变量和蓝图 API 实现
5. 接受公共变量 `object` 只保存稳定引用而不保存裸对象
6. 接受严格 `?dev` 开发入口和 `DEV-TOOLS` 可移除边界
7. 接受新引擎 2BSD 与游戏内容“如有利用需要请联系开发者授权”的双许可边界
8. Phase 1 同时实现本地开发服务器写盘；仍须限制到本机和允许的数据文件命名空间
9. 自定义窗口第一版布局范围确定为 `vertical`、`horizontal`、`grid`、`stack` 四种 flow
10. 第一版只实现单机文件存档，不接浏览器 IndexedDB 或云端存档

追加冻结决策（11–14 均确认通过）：

11. 下班模式不实现专用代码、专用 overlay 或 `OffDutyMode` 模块；它只是由自定义窗口编辑器创建的普通 `fullscreen` 窗口
12. 桌面图标双击不直接绑定窗口函数或时间函数，而是绑定稳定的内置 blueprint ID 和输入参数
13. 下班图标的内置 blueprint 负责按顺序执行 `openWindow(windowId="off-duty")` 与显式 `consumeTime`；推进时间属于 blueprint 行为，不属于桌面或窗口行为
14. 全屏、普通窗口、窗口生命周期、窗口存档和多窗口隔离全部走同一套通用实现

入口补充决策：

15. 开发期间始终以 `ng/` 为工作目录，在 `ng/` 内直接执行 `node dev-server.js`；开发服务器只绑定 `127.0.0.1`
16. `ng/` 成熟后整体移动到 project root，替代现有引擎并成为新的正式入口；这是 Phase 9 的一次性迁移，而非在早期阶段修改旧入口

后续执行顺序：从 Phase 1 开始，逐阶段提交可运行产物；每阶段完成后先运行验证和独立审查，再进入下一阶段；Phase 9 完成后才移除旧引擎。
