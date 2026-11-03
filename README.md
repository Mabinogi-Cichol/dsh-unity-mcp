# dsh-unity-mcp

让 DeepSeek Harness 通过 [MCP for Unity](https://github.com/CoplayDev/unity-mcp) 直接操作 Unity 编辑器：模型可以用自然语言创建场景与物体、编辑脚本、管理资源、跑测试、截图检查。

安装后你会得到三样东西：

- `mcp__unity__*` 工具集（约 50 个，随 unity-mcp 版本变化）
- `unity_mcp_status`：桥接自检工具，MCP 连不上时也能用
- `unity-mcp` 技能：Unity 打法与坑，按需加载，不占常驻上下文

需要 Unity 2021.3 LTS 或更新版本，工程里已安装 MCP for Unity 包，以及 `uv`（Python 3.10+）。本包与 Unity Technologies 无隶属关系；MCP for Unity 与本仓库同为 MIT。

## 安装

以下命令在 PowerShell / bash 中执行。`dsh` 是 DeepSeek Harness 自带的 CLI（在安装目录的 `resources/runtime/cli/bin` 下，必要时把它加入 `PATH`）；`<profile>` 换成目标 profile 名，例如 `desktop`。

**1. 启动 MCP server**

```bash
uvx --from mcpforunityserver mcp-for-unity --transport http --http-url http://127.0.0.1:8080
```

也可以不开这一条，改用 Unity 面板 `Window → MCP for Unity → Start Server`。

**2. 把本仓库装进 profile**

```bash
dsh plugin --profile <profile> add github:Mabinogi-Cichol/dsh-unity-mcp
```

默认取 `main` 最新提交。需要在 `#` 后指定分支、标签或提交 SHA 来锁定版本，例如 `github:Mabinogi-Cichol/dsh-unity-mcp#v1.0.0`。

装完用 `dsh plugin --profile <profile> list --depth 0` 确认列表里出现 `@local/dsh-unity-mcp`。

这是**快照安装**：pnpm 按仓库内容打包后放入 profile 的 `node_modules`，所以升级或改技能正文都要重新执行本步骤（换 tag 或 `remove` 后重装），不是原地生效。

**3. 启用 bundle**

编辑 `$DSH_HOME/profiles/<profile>/package.json`（Windows 为 `%DSH_HOME%\profiles\<profile>\package.json`），把包名加进 `dsh.profile.bundles`：

```json
"dsh": {
  "profile": {
    "bundles": ["@deepseek-ai/dsh-base", "@local/dsh-unity-mcp"]
  }
}
```

第 2 步只装文件，这一步才让 Harness 启动时加载它的补丁行。

**4. 重启 DeepSeek Harness**

命令行路线走 profile 清单，改动在下次启动时生效。（用 Harness 内的插件管理器直接指定该目录安装是等效的另一种做法，由它代写清单，通常无需重启。）

**5.（可选）环境变量**

| 变量 | 默认 | 用途 |
|---|---|---|
| `UNITY_MCP_URL` | `http://127.0.0.1:8080/mcp` | 端点。多实例时指向各自的端口 |
| `UNITY_PROJECT_PATH` | 空 | Unity 工程根目录（多个用 `;` 分隔），供 pid 存活检查 |

## 使用

直接用自然语言提需求即可，模型会自己挑工具：

```
在场景原点创建一个 Cube，加 Rigidbody，然后截图给我看
把 Assets/Scripts/Player.cs 里的移动速度改成 8，编译通过后告诉我
跑一次 PlayMode 测试
```

几个直接调工具的场合：

```
unity_mcp_status({ listTools: true })                          # 桥接是否正常、有哪些工具
mcp__unity__manage_scene({ action: "get_active" })             # 当前场景
mcp__unity__set_active_instance({ instance: "MyGame@abc123" })  # 多实例时先固定路由
```

**技能**：涉及 Unity 的任务会自动加载 `unity-mcp` 技能，其中写明了多实例路由、工具分组、改代码后必须验编译、写 C# 前核对 API 等流程。想手动查看：`skill({ name: "unity-mcp" })`。

**多实例**：同时开多个 Unity 编辑器时，给每个实例各起一个 server 端点，用 `UNITY_MCP_URL` 切换；或统一走默认端点，用 `set_active_instance` 指定目标。

**卸载**

```bash
dsh plugin --profile <profile> remove @local/dsh-unity-mcp
```

再从 `dsh.profile.bundles` 里删掉该名字，重启 Harness。


**连不上时**：先跑 `unity_mcp_status`。它不经过 MCP 连接，会直接告诉你端点是否可达、server 版本与协议、Unity 侧进程是否还活着，并给出下一步提示。
