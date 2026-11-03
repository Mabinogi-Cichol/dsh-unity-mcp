# @local/dsh-unity-mcp

DeepSeek Harness 单包接入：[CoplayDev/unity-mcp](https://github.com/CoplayDev/unity-mcp)（MCP for Unity）。

一个包三件事，省上下文与单包管理不冲突：

| 能力 | 由谁提供 | 进上下文时机 |
|---|---|---|
| `mcp__unity__*`（约 49 个工具） | patch 行 `mcp-unity` → `@deepseek-ai/dsh-mcp-client` | 工具 schema 常驻（MCP 机制决定，无法避免） |
| `unity_mcp_status` 诊断工具 | 本包 `index.js` | 注册即可见，只在调用时返回内容 |
| `unity-mcp` 技能（打法） | 本包 `index.js` + `skills/unity-mcp/SKILL.md` | **按需加载**，Unity 任务命中时才进上下文 |

## 链路

```
DSH Agent
  └─ mcp__unity__*（49 个工具）
       └─ @deepseek-ai/dsh-mcp-client   (streamable-http)
            └─ MCP-for-Unity server     http://127.0.0.1:8080/mcp
                 └─ Unity Editor 内的桥  (TCP 6400，由 Unity 包提供)
```

本包只管「Harness ↔ Python MCP server」这一段；server 与编辑器之间的桥由 unity-mcp 自己维护（`Window → MCP for Unity`）。

## 为什么 skill 不能单独存在

skill 是 `ctx.skills.register()` 注册的正文，**不能注册工具**。`mcp__unity__*` 的 schema 只来自 MCP 客户端行。所以本包保留 `mcp-unity` 行提供工具，skill 只负责「怎么打」。反过来，只有工具没有 skill，模型会凭训练数据乱猜 Unity API、在多实例下反复报错。

## 文件

| 文件 | 作用 |
|---|---|
| `cordis.patch.yml` | 两行：`mcp-unity`（MCP 客户端）、`mcp-unity-bridge`（本包模块） |
| `index.js` | 注册 `unity_mcp_status` 工具 + `unity-mcp` 技能；只依赖 Node 内置模块 |
| `skills/unity-mcp/SKILL.md` | 技能正文，八节打法，改它不用改代码 |
| `locale/*.json`、`icon.svg` | 插件管理器显示用 |

## 安装

```
plugin_manager { action: "install_bundle", target: "E:\\Git\\dsh-unity-mcp" }
```

- 首次安装即通过 HMR 生效，无需重启。
- 替换已装版本：目标是 `link:` 依赖，改文件本身会被 HMR 拾取；但整包 `remove_bundle` + `install_bundle` 到新路径时，务必确认旧的链接已解除，否则两处行会指向同一 `serverName` 而互相冲突。
- 旧的双包结构（`@local/dsh-unity-mcp-skill`）已合并进本包，`remove_bundle` 卸掉即可，避免同名技能重复注册。

## 仓库

源码在 `E:\Git\dsh-unity-mcp`，git 仓库以 `main` 为默认分支：

```
git status
git add -A && git commit -m "feat: unity-mcp harness bundle"
```

`.gitignore` 排除 `node_modules/`、`*.log` 与编辑器临时文件。本包是 profile 里的 `link:` 依赖，检出后无需构建，改完由 HMR 直接生效。

## 配置

| 环境变量 | 含义 |
|---|---|
| `UNITY_MCP_URL` | 覆盖 MCP 端点，例如多实例时指向 `http://127.0.0.1:6401/mcp` |
| `UNITY_PROJECT_PATH` | 一个或多个 Unity 工程根目录（`;` 分隔），供 pid 巡检 |

MCP 行关键参数：`serverName: unity`、`transport: streamable-http`、`toolCallTimeoutMs: 180000`（域重载/进 Play Mode 超过默认 60s）、`failOnStartupError: false`（编辑器没开也能启动）、`reconnect.initialDelayMs/maxDelayMs/maxAttempts: 2000/30000/30`、`maxInstructionBytes: 32768`。

## 验证

1. `unity_mcp_status({ listTools: true })` → `serverName: mcp-for-unity-server`、`protocolVersion: 2025-06-18`、`toolCount ≈ 49`。
2. 让 Agent 执行一次真实操作，例如 `mcp__unity__manage_scene({ action: "get_active" })`。
3. 技能目录出现 `unity-mcp`，`skill({ name: "unity-mcp" })` 返回正文，`Base directory` 指向本包 `skills/unity-mcp`。

## 故障排查

| 现象 | 处理 |
|---|---|
| `reachable: false`，TCP 失败 | 编辑器未开或未启动服务器；`Window → MCP for Unity → Start Server`，或手动 `uvx --from mcpforunityserver mcp-for-unity --transport http --http-url http://127.0.0.1:8080` |
| TCP 通但握手失败 | 8080 被别的 HTTP 服务占用，换端口并用 `UNITY_MCP_URL` 指过去 |
| 工具在但调用报多实例错误 | `mcp__unity__set_active_instance` 固定 `Name@hash` |
| 改完脚本下一轮调用超时 | 域重载所致，属正常；`unity_mcp_status` 确认编辑器仍活 |
| 技能目录里有两份 `unity-mcp` 来源 | 旧的 `@local/dsh-unity-mcp-skill` 还在，`remove_bundle` 卸掉 |

## 许可

MIT。图标自绘，未使用 Unity 官方商标素材。
