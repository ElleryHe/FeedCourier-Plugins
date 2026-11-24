# FeedCourier 插件市场

**[FeedCourier](https://github.com/ElleryHe/FeedCourier)**（`v0.3.1+`）官方单文件 JavaScript 插件市场、**Plugin API v1** 协议规范与内置插件目录。

[English](./README.md) | **简体中文** | [Plugin API v1 规范](./docs/plugin-api/v1.md) | [市场索引规范](./docs/marketplace.md)

---

## 核心特性

- **单文件 JS 插件（`plugin.js`）**：每个通道或处理插件版本均为独立的单文件 ES Module，直接运行于 FeedCourier 内置纯 ECMAScript 安全沙箱中（通过 `globalThis.fc` 调用受 SSRF 保护的网络与编解码能力）——**无需 Docker sidecar，无需在生产环境部署 Node.js，WebUI 一键安装升级**。
- **SHA-256 完整性校验**：[`scripts/build-index.mjs`](./scripts/build-index.mjs) 自动检查零 `import` 与沙箱合规性、校验 `meta` 导出、计算 `plugin.js` 精确 `sha256` 并生成 [`index.json`](./index.json)。
- **零外部依赖工具链**：校验、索引构建与单元测试仅依赖 **Node.js 24+** 内置能力。

## 官方插件一览

| 插件 | 类型 | 运行时 | 简介 |
| --- | --- | --- | --- |
| [**Bark 推送（Bark Push）**](./plugins/channels/bark/README.zh-CN.md) | `channel` | `js` | 通过 Bark（官方 `api.day.app` 或自建服务端）向 iOS/macOS 推送参考 Telegram 摘要模式排版的文章卡片 |
| [**ntfy 推送（ntfy Push）**](./plugins/channels/ntfy/README.zh-CN.md) | `channel` | `js` | 向 `ntfy.sh` 或自建 ntfy 服务器推送 RSS 文章通知，支持优先级、标签与 Bearer Token 认证 |
| [**链接替换（YOURLS）**](./plugins/builtin/link-rewrite/README.zh-CN.md) | `builtin` | `builtin` | 在渲染阶段通过自建 YOURLS 服务重写文章链接，内置 SQLite 缓存与严格重试模式 |

## 仓库目录结构

```text
plugins/
  builtin/link-rewrite/              # 官方内置 Rust 插件清单与文档
  channels/ntfy/0.3.1/plugin.js      # 官方 ntfy Push 通道插件
  channels/bark/0.3.1/plugin.js      # 官方 Bark Push 通道插件（摘要卡片风格）
docs/
  marketplace.md                     # 市场结构与 index.json 索引说明
  plugin-api/v1.md                   # Plugin API v1 开发文档
  plugin-api/v1.d.ts                 # globalThis.fc 与插件钩子的 TypeScript 类型定义
templates/
  channel-plugin.example.js          # 单文件通道插件起步模板
  processor-plugin.example.js        # 单文件处理插件起步模板
schema/manifest.schema.json          # 插件清单与 meta 的 JSON Schema (Draft 2020-12)
scripts/build-index.mjs              # 零依赖校验与 index.json 构建脚本
tests/                               # 基于模拟 globalThis.fc 的 Node.js 24 单元测试
index.json                           # 聚合市场索引（合入 main 后自动更新）
```

## 本地校验与测试

只需 **Node.js 24+**（零外部依赖）：

```bash
# 校验 Schema、插件源码沙箱合规性与模块导出
node scripts/build-index.mjs --check

# 重建 index.json 并校验一致性
node scripts/build-index.mjs && node scripts/build-index.mjs --check --verify-index

# 运行插件单元测试
node --test tests/*.test.mjs
```

## 提交插件上架

请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)、[`docs/plugin-api/v1.md`](./docs/plugin-api/v1.md) 并参考 [`templates/`](./templates/) 中的模板。

## 开源协议

与 FeedCourier 主仓库一致，本仓库采用 **GNU Affero General Public License v3.0 ([AGPL-3.0](./LICENSE))** 发布。
