# FeedCourier 插件市场注册表

**[FeedCourier](https://github.com/ElleryHe/FeedCourier)**（`v0.3.0+`）官方插件市场索引仓库与 Protocol v1 清单规范。

[English](./README.md) | **简体中文** | [FeedCourier 插件文档](https://feedcourier.ellery.me/zh/plugins/)

---

## 市场索引分发机制

1. 每个插件条目以独立的 JSON 文件存放在 [`registry/<id>.json`](./registry/) 目录下，严格遵循 [`schema/manifest.schema.json`](./schema/manifest.schema.json)（JSON Schema Draft 2020-12，插件协议 `api_version: "1"`）。
2. 每次提交 Pull Request 时，GitHub Actions 会运行 `node scripts/build-index.mjs --check` 校验字段类型、枚举、唯一 ID、语义化版本号与 HTTPS 链接。
3. PR 合并至 `main` 分支后，GitHub Actions 会自动运行 `node scripts/build-index.mjs` 重新聚合生成并提交 [`index.json`](./index.json)。
4. 运行中的 **FeedCourier** 服务通过带防 SSRF 校验的 HTTP 客户端拉取 `https://raw.githubusercontent.com/ElleryHe/FeedCourier-Plugins/main/index.json`（内存缓存 6 小时，可通过环境变量 `PLUGIN_INDEX_URL` 覆盖）；在离线或内网环境中自动回退至编译内置快照（`src/plugins/market_snapshot.json`）。**[FeedCourier 文档站](https://feedcourier.ellery.me/zh/plugins/)**在静态构建时也会加载同一份索引。

## 仓库目录结构

```text
schema/manifest.schema.json       # 插件协议 v1 的 JSON Schema (Draft 2020-12)
registry/link-rewrite.json        # 第一方「链接替换 (YOURLS)」插件清单
scripts/build-index.mjs           # 零依赖 Node.js 24+ 校验与索引构建脚本
index.json                        # 聚合生成的市场索引（合入 main 后自动更新）
.github/workflows/validate.yml    # PR 校验工作流
.github/workflows/build-index.yml # main 分支自动构建并提交 index.json 工作流
```

## 分阶段插件模型

- **第一阶段（`v0.3.0`）**：第一方内置插件（如 `link-rewrite`，`kind: "builtin"`）直接编译进 FeedCourier 单文件二进制，与未来第三方插件共用稳定的 Protocol v1 清单规范、SQLite 存储表（`plugins`、`plugin_instances`、`plugin_link_cache`）及 `on_render` 钩子生命周期；第三方插件（`kind: "external"` / `"coming_soon"`）现已支持在市场中展示介绍与源码仓库链接。
- **第二阶段（规划中）**：基于 WASM / Extism 沙箱的第三方插件运行时，在显式权限授权下执行 `on_render`、`on_ingest` 与 `on_delivered` 钩子。

## 本地校验

只需 **Node.js 24+**（零外部依赖）：

```bash
# 校验 Schema 与所有 registry/*.json（与 PR CI 检查一致）
node scripts/build-index.mjs --check

# 本地重建 index.json
node scripts/build-index.mjs

# 校验 index.json 与 registry/*.json 是否一致
node scripts/build-index.mjs --check --verify-index
```

## 提交插件上架

请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md) 与 [FeedCourier 插件开发手册](https://feedcourier.ellery.me/zh/plugins/development)。

## 开源协议

与 FeedCourier 主仓库一致，本仓库采用 **GNU Affero General Public License v3.0 ([AGPL-3.0](./LICENSE))** 发布。
