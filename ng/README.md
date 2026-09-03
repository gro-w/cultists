# cultists NG

`ng/` 是独立的新引擎入口，使用原生 HTML、CSS 与 ES modules。

```bash
cd ng
node dev-server.js
```

普通入口为 `index.html`，开发工具入口严格使用 `index.html?dev`。Activity、窗口、变量、结构、数据库和存档均由通用运行时管理。

## 内容改编接口（Phase 8）

旧内容不得直接导入旧引擎 API。改编时先把内容拆为结构定义、数据库记录、Activity blueprint、窗口定义和桌面图标绑定，再通过 `DataStore` 与 `ActivityExecutionService` 接入。每个迁移条目应保留稳定 ID、行为矩阵和确定性探针；旧存档不兼容。
