# FeedCourier 插件市场注册表

**[FeedCourier](https://github.com/ElleryHe/FeedCourier)**（`v0.3.0+`）官方插件市场索引仓库、**Plugin Protocol v1** 协议规范与参考 HTTP 桥接通道插件。

[English](./README.md) | **简体中文** | [FeedCourier 插件文档](https://feedcourier.ellery.me/zh/plugins/)

---

## 市场索引与桥接协议

1. 每个插件条目以独立的 JSON 文件存放在 [`registry/<id>.json`](./registry/) 目录下，严格遵循 [`schema/manifest.schema.json`](./schema/manifest.schema.json)（JSON Schema Draft 2020-12，插件协议 `api_version: "1"`）。
2. 进程外 **HTTP 桥接插件**（`runtime: "bridge"`，`FeedCourier >= 0.3.1`）遵循 [`schema/bridge-protocol.schema.json`](./schema/bridge-protocol.schema.json)（提供 `GET /manifest`、`POST /validate`、`POST /test`、`POST /deliver`、`POST /hooks/on_render`、`POST /hooks/on_delivered`，并使用 `±300s` 时间窗的 HMAC-SHA256 签名认证）。
3. 每次提交 Pull Request 时，GitHub Actions 会运行 `node scripts/build-index.mjs --check` 校验清单，并运行 `node --test channels/*/*.test.mjs` 执行零依赖通道桥接单元测试。
4. PR 合并至 `main` 后，GitHub Actions 会自动重建并提交聚合索引 [`index.json`](./index.json)。运行中的 FeedCourier 实例通过防 SSRF 客户端拉取该索引（6 小时缓存，离线时回退至内置快照）。

## 仓库目录结构

```text
schema/manifest.schema.json          # 插件协议 v1 清单 JSON Schema (Draft 2020-12)
schema/bridge-protocol.schema.json   # HTTP 桥接协议 v1 请求/响应 Schema
registry/link-rewrite.json           # 官方内置「链接替换 (YOURLS)」处理插件清单
registry/ntfy.json                   # 官方参考「ntfy Push」HTTP 桥接通道插件清单
channels/channel-template/           # 零依赖 Node.js 24 通道插件模板 + Dockerfile + 单元测试
channels/ntfy/                       # 参考 ntfy 通道桥接实现 + Dockerfile + 单元测试
scripts/build-index.mjs              # 零依赖 Node.js 24+ 校验与索引构建脚本
index.json                           # 聚合生成的市场索引（合入 main 后自动更新）
.github/workflows/validate.yml       # PR 清单校验与通道桥接单元测试工作流
.github/workflows/build-index.yml    # main 分支自动构建并提交 index.json 工作流
```

## 插件运行时模型（Protocol v1）

- **内置插件（`runtime: "builtin"`，`v0.3.0+`）**：第一方 Rust 插件直接编译进 FeedCourier 单文件二进制（如 `link-rewrite`）。
- **HTTP 桥接插件（`runtime: "bridge"`，`v0.3.1+`）**：以独立 sidecar / 容器运行的进程外扩展，支持自定义**投递通道插件**（`kind: "channel"`，实现 `/deliver`）与**处理插件**（`kind: "processor"`，实现 `on_render` / `on_delivered`）。管理员在 FeedCourier WebUI → **插件中心 → 添加桥接插件** 中登记桥接 URL 与共享密钥即可接入；FeedCourier 仅直连已登记的 `host:port`，不会放宽全局 `SSRF_ALLOWLIST`。

## 本地校验与测试

只需 **Node.js 24+**（零外部依赖）：

```bash
# 校验 Schema 与所有 registry/*.json
node scripts/build-index.mjs --check

# 重建 index.json 并校验一致性
node scripts/build-index.mjs && node scripts/build-index.mjs --check --verify-index

# 运行通道桥接插件单元测试
node --test channels/*/*.test.mjs
```

## 提交插件上架

请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md) 与 [FeedCourier 插件开发手册](https://feedcourier.ellery.me/zh/plugins/development)。

## 开源协议

与 FeedCourier 主仓库一致，本仓库采用 **GNU Affero General Public License v3.0 ([AGPL-3.0](./LICENSE))** 发布。
