# design/ · 设计方案与 UI 设计

本目录放**人写的设计过程产物**（方案、线框、原型），不是事实来源。与其它文档的分工：

| 位置 | 内容 | 是否事实来源 |
|---|---|---|
| `ARCHITECTURE.md` | 架构正典（当前实现） | 是 |
| `docs/` | 已成契约的规范（`PLUGIN-SPEC.md` / `NAVIGATION.md`） | 是 |
| `design/`（本目录） | 方案草案、UI 线框、交互原型 | 否，定稿后并入正典 |

## 结构

```
design/
├── README.md                     # 索引与约定（本文件）
├── architecture/                 # 方案设计
│   ├── plugin-ledger.md          # 样例：事件日志 + 快照投影
│   └── plugin-ledger.drawio.png  # 同名可编辑图
├── ui/                           # UI 设计
│   ├── shell-layout.md           # 样例：双端壳层
│   └── shell-layout.drawio.png
├── assets/                       # 多份文档共用的图（按需使用，样例未用到）
└── settings-master-detail.html   # 既有交互原型（CHANGELOG 已引用，保持不动）
```

## 命名与状态

- 文档 `<主题>.md`，图 `<主题>.drawio.png`，**同目录同名**，Markdown 用相对路径引用。
- 文档首部标注状态，只有三档：

  ```md
  > 状态：草案（2026-10-17）｜对应实现：`web/src/components/DockBar.vue`
  ```

  草案 / 已定稿 / 已废弃（附替代文档链接）。
- **定稿后抄结论，不搬文件**：结论合并进 `ARCHITECTURE.md` 或 `docs/` 对应章节，本目录原稿保留作为决策记录，形成单向引用（正典 → 设计稿）。

## 图的编辑方式

`.drawio.png` 是 **PNG 内嵌 diagram XML**，VSCode 安装 [Draw.io Integration](https://marketplace.visualstudio.com/items?itemName=hediet.vscode-drawio) 后可直接打开编辑、保存回写。

- 不要改名去掉 `.drawio`（否则下一个人会当成死图重画）；
- 不要用普通图片工具另存（会丢掉 XML，变成不可编辑）；
- 需要纯展示图时另存普通 `*.png`，放文档同目录；仅给 `docs/` 正文引用的图放 `docs/assets/`（按需创建），并注明来源 `.drawio.png`。

## 索引

| 文档 | 状态 | 对应实现 |
|---|---|---|
| `architecture/plugin-ledger.md` | 草案（样例） | `server/app/ledger.py` |
| `ui/shell-layout.md` | 草案（样例） | `web/src/App.vue`、`web/src/components/DockBar.vue` |
| `settings-master-detail.html` | 已实现 | `web/src/system/settings/` |
