/**
 * Unity MCP integration bundle — single package, both halves.
 *
 * 1. `unity_mcp_status` (tool): out-of-band health check for the MCP-for-Unity
 *    bridge — MCP handshake, server info, RunState pid liveness.
 * 2. `unity-mcp` (skill): the procedure for driving the Unity Editor through
 *    the `mcp__unity__*` tools, loaded only when a Unity task needs it.
 *
 * The transport itself is the `mcp-unity` row in ./cordis.patch.yml, which
 * mounts `@deepseek-ai/dsh-mcp-client`. A skill cannot register tools, so that
 * row remains the only source of the `mcp__unity__*` namespace.
 *
 * Only Node built-ins are imported, so the module activates regardless of how
 * the profile resolves `@deepseek-ai/*` packages.
 *
 * @module @local/dsh-unity-mcp
 */
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Cordis plugin name. */
export const name = 'unity-mcp-bridge'

/** Services used by this plugin; `skills` is read optionally through ctx.get. */
export const inject = ['tools']

const DEFAULT_ENDPOINT = 'http://127.0.0.1:8080/mcp'
const DEFAULT_TIMEOUT_MS = 8000

const SKILL_NAME = 'unity-mcp'
const PACKAGE_DIR = path.dirname(fileURLToPath(import.meta.url))
const SKILL_DIR = path.join(PACKAGE_DIR, 'skills', SKILL_NAME)
const SKILL_FILE = path.join(SKILL_DIR, 'SKILL.md')

const FALLBACK_SKILL = [
  '# Unity MCP',
  '',
  '先调用 `unity_mcp_status` 确认桥接，再用 `mcpforunity://instances` 与',
  '`mcp__unity__set_active_instance` 选定实例，最后才调用 `mcp__unity__*` 工具。',
].join('\n')

function loadSkillContent() {
  try {
    const text = fs.readFileSync(SKILL_FILE, 'utf8').trim()
    if (text.length > 0) {
      // Drop the frontmatter block: the registration fields carry name/description.
      return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim()
    }
  } catch {
    /* fall through to the minimal body */
  }
  return FALLBACK_SKILL
}

/**
 * Register the bridge diagnostic tool and the playbook skill.
 * @param ctx - context providing the tool registry and, optionally, skills.
 * @param config - resolved row config: `endpoint`, optional `projectPaths`.
 */
export function apply(ctx, config = {}) {
  registerTool(ctx, config)
  registerSkill(ctx)
}

function registerSkill(ctx) {
  const skills = typeof ctx.get === 'function' ? ctx.get('skills') : ctx.skills
  if (!skills || typeof skills.register !== 'function') return

  const registration = {
    name: SKILL_NAME,
    description:
      'Drive the Unity Editor through the MCP-for-Unity bridge: instance routing, tool groups, scene/object/script editing loops, compile-and-console verification, test runs, screenshot self-check, and Unity API verification before writing C#.',
    whenToUse:
      'Use when the task touches a Unity project through mcp__unity__* tools — editing scenes, prefabs, components, assets, materials, physics, UI, animation or scripts, running EditMode/PlayMode tests, or taking editor screenshots. Load it before the first Unity tool call.',
    source: 'bundled',
    resourceBase: { kind: 'directory', path: SKILL_DIR },
    invocation: { modelInvocable: true, userInvocable: true },
    content: loadSkillContent(),
  }

  const register = () => skills.register(registration)
  if (typeof ctx.effect === 'function') ctx.effect(register)
  else register()
}

function registerTool(ctx, config = {}) {
  const endpoint =
    typeof config.endpoint === 'string' && config.endpoint.length > 0 ? config.endpoint : DEFAULT_ENDPOINT
  const configuredProjects = Array.isArray(config.projectPaths)
    ? config.projectPaths.filter((item) => typeof item === 'string' && item.length > 0)
    : []

  const definition = {
    name: 'unity_mcp_status',
    description:
      '检查本机 Unity MCP 桥接状态（CoplayDev/unity-mcp）：对配置的 MCP 端点做 TCP 探测与 initialize 握手，读取 Unity 工程 Library/MCPForUnity/RunState 下的 pid 文件，判断编辑器进程是否存活。返回 serverInfo、协议版本、工具数量与诊断提示。不经过 MCP 连接本身，因此 MCP 工具不可用时仍可调用。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        endpoint: {
          type: 'string',
          description: '要探测的 MCP 端点；省略时使用插件配置的端点。',
        },
        projectPath: {
          type: 'string',
          description: 'Unity 工程根目录，用于读取 RunState pid 文件；Windows 形如 D:\\UnityProjects\\MyProject，macOS 形如 /Users/me/UnityProjects/MyProject。',
        },
        listTools: {
          type: 'boolean',
          description: '是否在握手后继续请求 tools/list 并返回工具名清单，默认 false。',
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          endpoint: { type: 'string' },
          reachable: { type: 'boolean' },
          tcp: {
            type: 'object',
            additionalProperties: false,
            properties: {
              host: { type: 'string' },
              port: { type: 'integer' },
              ok: { type: 'boolean' },
              error: { type: 'string' },
            },
          },
          handshake: {
            type: 'object',
            additionalProperties: false,
            properties: {
              ok: { type: 'boolean' },
              status: { type: 'integer' },
              protocolVersion: { type: 'string' },
              serverName: { type: 'string' },
              serverVersion: { type: 'string' },
              instructionBytes: { type: 'integer' },
              capabilities: { type: 'array', items: { type: 'string' } },
              toolCount: { type: 'integer' },
              tools: { type: 'array', items: { type: 'string' } },
              error: { type: 'string' },
            },
          },
          pidFiles: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                file: { type: 'string' },
                project: { type: 'string' },
                port: { type: 'integer' },
                pid: { type: 'integer' },
                alive: { type: 'boolean' },
              },
            },
          },
          notes: { type: 'array', items: { type: 'string' } },
        },
        required: ['endpoint', 'reachable', 'notes'],
      },
      render(_args, value) {
        return [{ type: 'text', text: renderStatus(value) }]
      },
    },
    async execute(args, exec) {
      const rawArgs = args !== null && typeof args === 'object' ? args : {}
      const target = typeof rawArgs.endpoint === 'string' && rawArgs.endpoint ? rawArgs.endpoint : endpoint
      const url = resolveUrl(target)
      const timeoutMs = DEFAULT_TIMEOUT_MS

      const tcp = await probeTcp(url.hostname, portOf(url), timeoutMs)
      let handshake
      if (tcp.ok) {
        handshake = await handshakeOf(url, timeoutMs, rawArgs.listTools === true)
        if (exec?.signal?.aborted) throw new Error('unity_mcp_status 已取消')
      } else {
        handshake = { ok: false, error: `端点不可达：${tcp.error ?? '未知原因'}` }
      }

      const projects = [...new Set([rawArgs.projectPath, ...configuredProjects].filter(isNonEmptyString))]
      const pidFiles = collectPidFiles(projects)

      return {
        endpoint: url.href,
        reachable: handshake.ok === true,
        tcp: { host: url.hostname, port: portOf(url), ok: tcp.ok === true, ...(tcp.error ? { error: tcp.error } : {}) },
        handshake,
        pidFiles,
        notes: collectNotes({ url, tcp, handshake, pidFiles, projects }),
      }
    },
  }

  const register = () => ctx.tools.register(definition)
  if (typeof ctx.effect === 'function') ctx.effect(register)
  else register()
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0
}

function resolveUrl(raw) {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return new URL(DEFAULT_ENDPOINT)
    return url
  } catch {
    return new URL(DEFAULT_ENDPOINT)
  }
}

function portOf(url) {
  if (url.port) return Number.parseInt(url.port, 10)
  return url.protocol === 'https:' ? 443 : 80
}

function probeTcp(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port })
    let settled = false
    const finish = (ok, error) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(ok ? { ok: true } : { ok: false, error })
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false, `TCP 连接超时 ${timeoutMs}ms`))
    socket.once('error', (error) => finish(false, error?.code ?? error?.message ?? String(error)))
  })
}

function parseMcpBody(text) {
  const trimmed = typeof text === 'string' ? text.trim() : ''
  if (!trimmed) return undefined
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed)
    } catch {
      /* fall through to SSE parsing */
    }
  }
  const payloads = trimmed
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter((line) => line.length > 0)
  for (let index = payloads.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(payloads[index])
    } catch {
      /* try the previous event */
    }
  }
  const joined = payloads.join('')
  if (joined) {
    try {
      return JSON.parse(joined)
    } catch {
      return undefined
    }
  }
  return undefined
}

function describeRpcError(payload) {
  const error = payload?.error
  if (error && typeof error === 'object') {
    const message = typeof error.message === 'string' ? error.message : JSON.stringify(error)
    return typeof error.code === 'number' ? `${message} (code ${error.code})` : message
  }
  return '响应中缺少 result 字段'
}

async function mcpPost(url, method, params, sessionId, timeoutMs, notification = false) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  }
  if (sessionId) headers['mcp-session-id'] = sessionId
  const message = notification ? { jsonrpc: '2.0', method, ...(params ? { params } : {}) } : { jsonrpc: '2.0', id: 1, method, params }
  const response = await fetch(url.href, {
    method: 'POST',
    headers,
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await response.text()
  return {
    ok: response.ok,
    status: response.status,
    sessionId: response.headers.get('mcp-session-id') ?? sessionId,
    payload: parseMcpBody(text),
  }
}

async function handshakeOf(url, timeoutMs, wantTools) {
  try {
    const init = await mcpPost(
      url,
      'initialize',
      {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'dsh-unity-mcp', version: '1.0.0' },
      },
      undefined,
      timeoutMs,
    )
    const result = init.payload?.result
    if (!init.ok || !result || typeof result !== 'object') {
      return { ok: false, status: init.status, error: describeRpcError(init.payload) }
    }
    const info = {
      ok: true,
      status: init.status,
      protocolVersion: typeof result.protocolVersion === 'string' ? result.protocolVersion : undefined,
      serverName: typeof result.serverInfo?.name === 'string' ? result.serverInfo.name : undefined,
      serverVersion: typeof result.serverInfo?.version === 'string' ? result.serverInfo.version : undefined,
      instructionBytes:
        typeof result.instructions === 'string' ? Buffer.byteLength(result.instructions, 'utf8') : 0,
      capabilities:
        result.capabilities && typeof result.capabilities === 'object' ? Object.keys(result.capabilities) : [],
    }
    try {
      await mcpPost(url, 'notifications/initialized', {}, init.sessionId, timeoutMs, true)
    } catch {
      /* optional notification */
    }
    if (!wantTools) return info
    const list = await mcpPost(url, 'tools/list', {}, init.sessionId, timeoutMs)
    const tools = Array.isArray(list.payload?.result?.tools)
      ? list.payload.result.tools.map((tool) => tool?.name).filter((toolName) => typeof toolName === 'string')
      : []
    return { ...info, toolCount: tools.length, tools }
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError'
    return { ok: false, error: timedOut ? `握手超时 ${timeoutMs}ms` : (error?.message ?? String(error)) }
  }
}

function isPidAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

function collectPidFiles(projects) {
  const rows = []
  for (const project of projects) {
    const runStateDir = path.join(project, 'Library', 'MCPForUnity', 'RunState')
    let entries
    try {
      entries = fs.readdirSync(runStateDir)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.toLowerCase().endsWith('.pid')) continue
      const file = path.join(runStateDir, entry)
      let pid
      try {
        pid = Number.parseInt(fs.readFileSync(file, 'utf8').trim(), 10)
      } catch {
        pid = undefined
      }
      const portMatch = /(\d{2,5})/.exec(entry)
      rows.push({
        file,
        project,
        ...(portMatch ? { port: Number.parseInt(portMatch[1], 10) } : {}),
        ...(Number.isFinite(pid) ? { pid } : {}),
        alive: isPidAlive(pid),
      })
    }
  }
  return rows
}

function collectNotes({ url, tcp, handshake, pidFiles, projects }) {
  const notes = []
  if (tcp.ok) notes.push(`TCP ${url.hostname}:${portOf(url)} 可连接。`)
  else notes.push(`${url.hostname}:${portOf(url)} 不可连接（${tcp.error ?? '未知原因'}）：Unity 编辑器可能已关闭，或 Window → MCP for Unity 未启动服务器。`)
  if (handshake.ok) {
    notes.push(
      `握手成功：${handshake.serverName ?? '未知服务器'} ${handshake.serverVersion ?? ''} 协议 ${handshake.protocolVersion ?? '未知'}。`.replace(/\s+/g, ' ').trim(),
    )
    if (typeof handshake.toolCount === 'number') notes.push(`tools/list 返回 ${handshake.toolCount} 个工具。`)
    else notes.push('未请求工具清单；需要时以 listTools=true 再调用一次。')
  } else if (tcp.ok) {
    notes.push(`TCP 可连接但 MCP 握手失败：${handshake.error ?? '未知原因'}。`)
  }
  if (projects.length === 0) notes.push('未提供 Unity 工程路径，跳过 RunState pid 检查；需要时传入 projectPath。')
  else if (pidFiles.length === 0) notes.push('RunState 下没有 pid 文件：该工程从未通过编辑器启动 MCP 服务器，或端口不同。')
  else {
    const dead = pidFiles.filter((row) => row.alive !== true)
    notes.push(
      dead.length === 0
        ? `RunState：${pidFiles.length} 个 pid 文件对应的进程均在运行。`
        : `RunState：${dead.length} 个 pid 文件对应进程已退出，属于残留文件，可忽略或清理。`,
    )
  }
  notes.push('手动启动：uvx --from mcpforunityserver mcp-for-unity --transport http --http-url http://127.0.0.1:8080')
  notes.push('切换端点：设置环境变量 UNITY_MCP_URL 后重新加载该插件行。')
  return notes
}

function renderStatus(value) {
  const lines = []
  lines.push(`端点: ${value.endpoint}`)
  lines.push(`可达: ${value.reachable ? '是' : '否'}`)
  if (value.tcp) {
    lines.push(`TCP: ${value.tcp.host}:${value.tcp.port} ${value.tcp.ok ? 'ok' : `失败 (${value.tcp.error ?? '未知'})`}`)
  }
  const handshake = value.handshake
  if (handshake?.ok) {
    lines.push(
      `MCP: ${handshake.serverName ?? '未知'} ${handshake.serverVersion ?? ''} | 协议 ${handshake.protocolVersion ?? '未知'} | 指令 ${handshake.instructionBytes ?? 0} 字节`,
    )
    if (Array.isArray(handshake.capabilities) && handshake.capabilities.length > 0) {
      lines.push(`能力: ${handshake.capabilities.join(', ')}`)
    }
    if (typeof handshake.toolCount === 'number') {
      lines.push(`工具: ${handshake.toolCount} 个`)
      if (Array.isArray(handshake.tools) && handshake.tools.length > 0) {
        lines.push(`  ${handshake.tools.slice(0, 60).join(', ')}`)
      }
    }
  } else if (handshake) {
    lines.push(`MCP: 握手失败 - ${handshake.error ?? '未知原因'}`)
  }
  if (Array.isArray(value.pidFiles) && value.pidFiles.length > 0) {
    lines.push('RunState:')
    for (const row of value.pidFiles) {
      lines.push(`  ${row.file} | pid ${row.pid ?? '?'} | ${row.alive ? '运行中' : '已退出'}`)
    }
  }
  if (Array.isArray(value.notes) && value.notes.length > 0) {
    lines.push('')
    for (const note of value.notes) lines.push(`- ${note}`)
  }
  return lines.join('\n')
}
