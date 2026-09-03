# Phase 8 内容改编规范

每个旧内容模块使用以下独立文件：

- `structures/<id>.json`：字段和校验
- `databases/<id>.json`：记录集合
- `activities/<id>.json`：唯一 Activity blueprint
- `windows/<id>.json`：窗口与组件树
- `desktop-icons.json`：图标和稳定 blueprint/window 引用

迁移顺序为“数据结构 → 数据库 → blueprint → 窗口 → 图标 → 探针”。禁止复制旧运行时模块、旧队列 API 或旧 UI 回调。行为矩阵至少记录输入、可见输出、时间成本、状态效果、失败路径、队列实例 ID 和存档字段。
