# 追逐事件项目文档

## 1. 功能概述

“追逐事件”是一个接入现有活动、蓝图、法术、CG 和结局系统的特殊事件，不使用独立 Demo 或 UI 硬编码剧情。

事件稳定 ID：`追逐事件`

剧本来源：`追逐事件-3.txt`。附件原文为 GB18030 编码；导入时按原始字节解码，剧情台词、顺序和选项逻辑以原文为准。

## 2. 触发规则

事件元数据位于 `data/zh-hans/special_events.json`：

```json
{
  "id": "追逐事件",
  "phase": "day",
  "startDay": 7,
  "endDay": 7,
  "condition": { "id": 1, "op": "lt", "value": 50 }
}
```

含义：第 7 天白天，主角 SAN 严格低于 50 时触发。SAN 等于 50 不满足条件。事件使用现有特殊事件和一次性活动机制，避免普通地点刷新、页面刷新或重复状态更新造成重复入队。

## 3. 蓝图流程

事件蓝图的 `startNodeId` 为 `start`，所有剧情都由 `ActivityRunner` 执行。

```text
start
  -> CG：宿舍坏
  -> 宿舍开场对白（5 行）
  -> CG：海边
  -> 追逐对白
  -> “你们 / 既然 / 追上 / 了我 / 那么”（5 个独立节点）
  -> choice
       ├─ 使用万字符
       │    -> 消耗万字符
       │    -> 扣 5 SAN
       │    -> spellEffect：旧印开光术
       │         ├─ 未有历史施放记录 -> 正常 CG -> 正常结局对白
       │         └─ 已有历史施放记录 -> 异常 CG -> 异常结局对白
       ├─ 使用支配术
       │    -> spellCast：支配术异步活动
       │    -> 异常 CG -> 异常结局对白
       └─ 接受注定的终局
            -> 正常 CG -> 正常结局对白
```

节点数量当前为 47，蓝图探针确认所有节点可从起点到达。

## 4. 选项与法术边界

### 使用万字符

- `requiredItemId: "swastika"`：背包中没有万字符时不显示可选项。
- `requiredSpellId: "book_moon__0"`：必须已经习得旧印开光术。
- 选择后由蓝图执行 `inventoryOperation` 消耗一个万字符，再由 `statOperation` 扣除 5 SAN。
- 随后使用 `spellEffect` 根据旧印开光术的历史效果状态分流。

### 使用支配术

- `requiredSpellId: "book_coc7__0"`：必须已经习得支配术。
- 使用 `spellCast`，由现有法术使用活动处理成本和施法事件。
- 不能依赖 `SpellManager.cast()` 的即时返回值判断最终效果；法术施放是异步活动，蓝图在正式施放活动之后继续进入异常路线。

### 历史状态

`SpellEffectManager` 只在旧印效果真正执行时读取历史状态。追逐事件不能在选项显示或选择瞬间无条件写入“已施放”状态，否则第一次使用万字符也会错误进入异常结局。

## 5. CG 资源

事件通过 `showCg` 节点引用现有 CG 稳定 ID，按 CG 标签复用，不重复创建：

| 剧情位置 | 标签 | 稳定 ID |
| --- | --- | --- |
| 开场 | 宿舍坏 | `cg_exrn4m_1` |
| 逃到海边 | 海边 | `cg_extit1_7` |
| 异常路线 | 蹈海3 | `cg_ewexmk_b` |
| 正常路线 | 正常 | `cg_ewexmk_h` |

当前四个 CG 均有实际 `imageData`。CG 的显示和结束由 `CGManager` 接收 `ActivityRunner` 发出的 `activity:cg` / `activity:end_cg` 事件处理。

## 6. 结局

`data/zh-hans/endings.json` 中保留两个稳定结局 ID：

- `正常结局`
  - 显示名：`正常结局：接受注定的终局`
  - 结尾描述：接受死亡的终局，放下徒劳的逃亡。
- `异常结局`
  - 显示名：`异常结局：被未知的力量吞没`
  - 结尾描述：试图用禁忌力量逃离追逐，却被疯狂与海流吞没。

蓝图终点使用 `ending` 节点调用 `EndingManager`，随后以 `activityEnd` 结束，不由 UI 私自切换结局标题。

结局界面 `EndingScreen` 会从结局蓝图的真实 `startNodeId` 创建 `mainQueue` 活动实例并播放，支持逐行对白、CG 背景、底部对话框、主控左侧和 NPC 右侧立绘。多行旧文本会在 UI 边界按换行拆成单独对白；一次 Continue 只推进一行。

## 7. NPC 结局专用立绘

NPC 普通立绘仍使用 `portraits` 的 SAN 区间选择。新增可选字段 `endingPortraits`，用于与 SAN 无关的结局立绘：

```json
{
  "id": "binbin",
  "endingPortraits": [
    {
      "endingId": "异常结局",
      "imageData": "data:image/png;base64,..."
    }
  ]
}
```

选择规则：

1. `EndingScreen` 读取当前结局稳定 ID。
2. 在对应 NPC 的 `endingPortraits` 中精确匹配 `endingId`。
3. 匹配且有图片时优先使用结局专用立绘。
4. 没有匹配项或图片为空时回退普通 `portraits` 立绘。

开发人员模式的 NPC 管理器已经增加：

- 添加/删除结局专用立绘变体；
- 填写结局 ID；
- 上传图片并预览；
- 保存到内存、下载或写入 `npcs.json`；
- 同一 NPC 的结局 ID 重复校验。

该功能目前不自动生成图片。需要具体结局立绘时，在 NPC 管理器中为目标 NPC 添加变体，填写例如 `异常结局`，再上传图片。

## 8. 相关文件

| 文件 | 职责 |
| --- | --- |
| `data/zh-hans/special_events.json` | 追逐事件触发条件、蓝图、对白、分支、CG 和结局节点 |
| `data/zh-hans/endings.json` | 正常/异常结局定义和最终描述 |
| `data/zh-hans/cg.json` | CG 标签、稳定 ID 和图片数据 |
| `data/zh-hans/npcs.json` | NPC 普通 SAN 立绘和结局专用立绘数据 |
| `js/core/ActivityRunner.js` | 选项条件、法术节点和蓝图执行 |
| `js/core/SpellEffectManager.js` | 旧印/支配术效果及历史状态分流 |
| `js/desktop/EndingScreen.js` | 结局蓝图播放、逐行显示和结局立绘选择 |
| `js/desktop/DeveloperMode.js` | NPC 立绘与结局专用立绘编辑器 |
| `docs/DATA-SCHEMAS.md` | NPC `endingPortraits` 数据字段说明 |

## 9. 验证记录

已完成静态验证：

```text
CHASE_BLUEPRINT_OK nodes=47 all_reachable=1 trigger=day7_sanity_lt50 choices=3 cg=4 endings=2
```

并已通过：

```text
node --check js/core/ActivityRunner.js
node --check js/core/SpellEffectManager.js
node --check js/core/EndingScreen.js
node --check js/desktop/DeveloperMode.js
git diff --check
```

蓝图探针覆盖：触发天数/时段/SAN 比较符、三项选项、物品和法术条件、CG ID、两个结局 ID 以及节点可达性。

尚未完成浏览器内逐项点击测试；静态探针不能替代真实游戏试玩。