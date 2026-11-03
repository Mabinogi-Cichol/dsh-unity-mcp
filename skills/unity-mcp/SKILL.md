---
name: unity-mcp
description: Drive the Unity Editor through the MCP-for-Unity bridge.
---

# Unity MCP：用工具驱动 Unity 编辑器

适用：需要读/改 Unity 场景、GameObject、组件、资源、脚本、材质、物理、构建、测试，或要跑 Play Mode / 截图自评的时候。核心前提是 `mcp__unity__*` 工具已注册；没有这组工具时本 skill 只能靠 `pwsh` 打 JSON-RPC，成本高得多。

## 0. 先确认桥接活着

1. `unity_mcp_status` —— 不经过 MCP 连接本身，桥挂了也能用。看 `reachable`、`handshake.serverName`（应为 `mcp-for-unity-server`）、`pidFiles[].alive`。
2. 不可达时：让用户在 Unity 里 `Window → MCP for Unity → Start Server`，或提示手动命令 `uvx --from mcpforunityserver mcp-for-unity --transport http --http-url http://127.0.0.1:8080`。不要自己乱起进程抢 8080，端口冲突会把一条好链路搞死。

## 1. 多实例必须先定路由

本机常同时开多个编辑器（UI 工程、客户端工程）。开工第一件事：

- 读资源 `mcpforunity://instances` 拿 `Name@hash` 列表；
- 调用 `mcp__unity__set_active_instance({ instance: "MyGame@abc123" })` 固定本次会话的路由，或每次调用都带 `unity_instance` 参数；
- 两个实例都在线又没定路由时，工具会直接报错——这是最常见的「明明连着却调不动」。

## 2. 每次动手前查自定义工具

读资源 `mcpforunity://custom-tools`。工程可能注册了 `execute_custom_tool` 的快捷入口；有的话优先用，比手搓 `execute_code` 稳。

## 3. 工具分组要按需开

`manage_tools` 管理可见分组：`core`、`docs`、`scripting_ext`、`testing`、`ui`、`vfx`、`animation`、`probuilder`、`profiling`、`asset_gen`。默认只开一部分；要动材质/动效/构建前先 `manage_tools({ action: "activate", group: "vfx" })`，用完可 `deactivate` 省上下文。

## 4. 四条标准回路

**场景/对象编辑**
```
manage_scene({ action: "get_active" })                       # 拿当前场景，先确认改的是对的那个
manage_scene({ action: "get_hierarchy", page_size: 50 })      # 分页；大场景别一次拉全套
manage_gameobject({ action: "create", name: "...", primitive_type: "Cube", position: [0,1,0] })
manage_components({ action: "add", target: <id>, component_type: "Rigidbody" })
```
读组件用资源 `mcpforunity://scene/gameobject/{id}/components`，先 `include_properties=false` 看结构，需要再取属性。批量新建务必用 `batch_execute`（一次最多 25 条），别一条条调。

**脚本改动（最容易炸的一环）**
```
create_script / apply_text_edits / script_apply_edits   → 改代码
validate_script                                          → 先静态校验
read_console({ types: ["error"], count: 20 })            → 等域重载后确认编译错误
refresh_unity({ compile: "request", wait_for_ready: true })  → 触发重编并等就绪
```
`index.js`/`.cs` 写盘后必然触发编译与域重载，**紧接着的下一次 MCP 调用可能超时**，这不是桥坏了；重试或先用 `unity_mcp_status` 确认编辑器还活着。

**测试**
```
run_tests({ mode: "EditMode" | "PlayMode" })  → 返回 job_id
get_test_job({ job_id, wait_timeout: 30 })    → 轮询，PlayMode 首轮可能要 120s
```
不要用 `pwsh` 起 Unity 跑测试，编辑器已经在跑就别开第二个 batchmode 实例。

**截图自评**
`manage_camera({ action: "screenshot", include_image: true })`；要看多角度用 `batch: "surround"`。Camera 渲染不含 Screen Space-Overlay 的 UI，验证 UI 用 `manage_ui({ action: "render_ui" })`。

## 5. 别凭记忆写 Unity API

训练数据里的 Unity API 经常是错的或过时的。写 C# 之前：

- `mcp__unity__unity_reflect({ action: "search", query: "..." })` → `get_type` → `get_member` 确认签名；
- `mcp__unity__unity_docs({ action: "get_doc" | "get_manual" })` 拿官方示例与坑；
- 找 shader/材质先 `manage_asset({ action: "search", filter_type: "Shader" })`，不要凭空报 shader 名；
- 已知高频幻觉区：Input System、Cinemachine、ProBuilder、NavMesh、URP/HDRP 与版本相关的 API。

## 6. 结果别灌满上下文

- 分页：`manage_scene get_hierarchy` 用 `page_size` + `cursor`；`manage_gameobject get_components` 用小 page_size 且 `include_properties=false`。
- 不要 `generate_preview=true`，base64 缩略图会吃掉大量 token。
- 批量读用 `batch_execute` 的只读命令并行，不要在对话里堆 N 次往返。

## 7. 本机环境备忘

- 客户端工程：`E:\Unity\StarWings\ClientDevelopment`（Unity 2022.3.62f2），MCP pid 记录在 `Library/MCPForUnity/RunState/mcp_http_*.pid`。
- UI 工程另开实例（`E:\Unity\StarWingsUI\WingsUi_3.3.0`）；两边都要操作时，每个工程各起一个端点，用 `UNITY_MCP_URL` 或 `unity_instance` 区分。
- 端点默认 `http://127.0.0.1:8080/mcp`；换端口改 `UNITY_MCP_URL` 后重载插件行。

## 8. 停下来问人的时机

- 目标不明确（改哪个场景/哪个 prefab）：先问，不要猜着改。
- 操作不可逆且影响面大（删资源、覆盖 prefab、改 ProjectSettings、切平台）：先说明再动手。
- 编辑器长时间无响应、`read_console` 报编译错误且两轮修不掉：停下来报告错误原文，别继续堆改动。

## 版本

本正文随 `@local/dsh-unity-mcp` 1.1.0 一起分发（单包）；早前独立的 `@local/dsh-unity-mcp-skill` 已合并进本包。
