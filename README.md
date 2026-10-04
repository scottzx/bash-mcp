# @1agents/bash-mcp

把目标节点的 Bash 终端与文件搜索发布到 DreamMate 能力网络。其他项目的智能体通过
`dreammate_invoke` 调用，由目标节点本地执行，返回原生 MCP `structuredContent` 与兼容的
JSON 文本。执行基座采用 [mcp-server-commands@0.8.2](https://github.com/g0t4/mcp-server-commands)，
包装不启动另一套上游 MCP daemon；选型记录见 [docs/selection.md](docs/selection.md)。

```text
其他项目 / 智能体
    → dreammate-node（目标节点 :36908）
    → bash-mcp（127.0.0.1:7785）
    → 本机 Bash / argv / ripgrep
    ← structuredContent / JSON
```

## 安装与发布到能力网络

需要 Node.js ≥22.5、macOS 或 Linux、Bash。文件搜索需要安装 `rg`（ripgrep）。
目标节点需要运行 Dreammate 网关；客户端需要能访问该网关。

```bash
npm install -g @1agents/bash-mcp
bash-mcp install --cwd /absolute/project/path
bash-mcp status
```

`install` 将已安装的程序装成 macOS LaunchAgent 或 Linux systemd user service，
开机/登录时拉起，故障自动重启，随后报备 `service_id=bash`。只有健康检查和网关报备
都成功才返回安装成功。日志在 `~/.1agents/bash-mcp/logs/`；Linux 日志用
`journalctl --user -u bash-mcp.service` 查看。用户级 systemd 常驻跨登出需要设备已有 linger。
部署后保留 npm 全局安装目录。源码开发可用 `npm ci` 后运行
`node bin/bash-mcp.mjs install --cwd /absolute/project/path`。

```bash
# 前台运行并自动报备；网关暂不可用时服务照常运行并持续尝试报备
node bin/bash-mcp.mjs serve --cwd /absolute/project/path

# 独立 stdio MCP
node bin/bash-mcp.mjs mcp --cwd /absolute/project/path

# 卸载常驻服务，保留源码和日志
node bin/bash-mcp.mjs uninstall
```

服务固定监听回环地址。`--port`、`--id`、`--agent`、`--shell`、`--rg` 和
`--max-concurrent` 可调整；`--agent` 只接受本机 HTTP 网关。单独运行 HTTP、无需报备时
使用 `serve --no-report`。环境变量：`BASH_MCP_CWD`、`BASH_MCP_PORT`、`DREAMMATE_AGENT_URL`。

## 智能体发现与调用

先 `dreammate_list_services(keyword="bash", node="all")`，再
`dreammate_inspect(service_id="bash", node="目标节点")` 查看方法与参数。
完整指引已随服务报备，可用 `dreammate_inspect(skill="bash-mcp", ...)` 或
`dreammate_download_skill(skill="bash-mcp", ...)` 获取。

| 方法 | 用途 |
| --- | --- |
| `bash.exec` | Bash 命令或直接 argv；stdin、cwd、期限与 JSON 输出解析 |
| `bash.job_get` | 查询任务状态和结果，不重复执行 |
| `bash.job_cancel` | 取消并终止进程组 |
| `bash.jobs` | 列出保留任务的概要 |
| `bash.search` | ripgrep 搜索，返回 JSON 匹配记录 |
| `bash.info` | 平台、默认目录、依赖与资源上限 |

例如调用 `dreammate_invoke`：

```json
{
  "node": "scott-mac",
  "service_id": "bash",
  "method": "bash.exec",
  "params": {
    "argv": ["git", "status", "--porcelain=v1"],
    "cwd": "/absolute/project/path",
    "output_format": "text"
  }
}
```

`command` 支持 Bash 管道、重定向、变量；`argv` 将每个参数原样交给可执行文件。
二者只选一个。每次执行独立 shell，前一次的 `cd`、`export` 不会留给下一次。
用 `cwd` 指定目录，或在同一条命令中完成相关操作。

### 长命令

`wait_ms` 默认 800、最大 1000；未完成即返回 `status="running"`、`job_id` 和下一步参数。
这时命令已经启动，使用 `bash.job_get` 轮询同一 ID。默认总执行期限 30 秒，
`timeout_ms` 最大 300000。无需让 DreamMate 的一次 HTTP 转发等待整段构建时间。

```json
{"service_id":"bash","method":"bash.exec","params":{"command":"npm test","cwd":"/absolute/project/path","timeout_ms":120000,"wait_ms":0}}
```

```json
{"service_id":"bash","method":"bash.job_get","params":{"job_id":"返回的 ID","wait_ms":1000}}
```

完成结果包含 `success`、`exit_code`、`signal`、`stdout`、`stderr`、`duration_ms`，
超时和取消有单独状态与错误码。失败会设置 MCP `isError=true`。
任务仅在服务进程内保留，默认完成后 10 分钟，最多 100 条；重启会取消任务并清空记录。
并行执行默认最多 4 条。达到上限返回 `BUSY` 或 `JOB_CAPACITY`，不会偷偷排队或重试。

### JSON 数据与搜索

`output_format="json"` 解析一个 JSON 文档，`"jsonl"` 解析每行 JSON，数据在
`structuredContent.data`。默认 `"auto"` 尝试 JSON，失败保留原始文本。
明确要求 JSON 而解析失败时返回 `INVALID_OUTPUT`，同时保留实际命令的退出码和输出；
命令可能已经成功执行，不能因为解析错误再次执行写命令。

```json
{"service_id":"bash","method":"bash.exec","params":{"argv":["jq",".items[] | {id,name}"],"stdin":"{\"items\":[{\"id\":1,\"name\":\"demo\"}]}","output_format":"jsonl"}}
```

搜索文件无需解析终端表格：

```json
{"service_id":"bash","method":"bash.search","params":{"pattern":"TODO","path":"/absolute/project/path","glob":["*.ts","!node_modules/**"],"max_matches":100}}
```

`matches` 包含 `path`、`line_number`、`text`、`submatches`。默认字面匹配，
可启用 `regex`、`ignore_case`、`hidden`。非 UTF-8 文件名和内容保留原始 base64 字段。
没有匹配返回成功空数组；无效正则、权限错误、缺少 `rg` 或超时返回失败。
`max_matches` 同时限制每文件扫描匹配与总返回记录，默认 100、最大 1000。
达到匹配或输出上限时 `truncated=true`，结果不能视作完整清单。

命令输出默认每路最多返回 64 KiB，可设 `max_output_bytes` 到 1 MiB。输出总字节数
和截断状态始终保留；截断 JSON 不会冒充完整结构化数据。worker 堆超限会终止任务并
返回 `OUTPUT_RESOURCE_LIMIT`；大规模数据应由命令自行筛选、分页或写到文件后分段读取。

`bash.search` 搜索节点文件；已有网络搜索工具的数据也可通过 `stdin` 交给 jq/Python
做结构化处理，此包装不新增搜索引擎。

## CLI 与标准 MCP

```bash
node bin/bash-mcp.mjs invoke --method bash.exec --params '{"command":"pwd"}'
node bin/bash-mcp.mjs invoke --params - < request.json
node bin/bash-mcp.mjs manifest

# 通过 Dreammate CLI（≥0.8.0）从本机其他项目调用
dreammate-node cli invoke --agent http://127.0.0.1:36908 --node scott-mac --service bash --method bash.info --params '{}'
```

本地 `invoke` 连接已有 HTTP 服务，因此任务在多次 CLI 调用之间仍然存在。
CLI stdout 是 JSON；失败退出码为 1。标准 MCP 配置：

```json
{"mcpServers":{"bash":{"command":"node","args":["/absolute/bash-mcp/bin/bash-mcp.mjs","mcp","--cwd","/absolute/project/path"]}}}
```

命令以宿主账号权限执行，`cwd` 不是目录权限边界，worker 堆限制也不是 OS 沙箱。
网络访问控制由现有 DreamMate 网关与所在网络承担；应在已授权的可信节点网络中使用。
本版本不提供 PTY 交互和持久化 shell 会话，Windows 需在 WSL 内运行。

## 验证

```bash
npm run check
npm test
npm pack
```

测试覆盖 argv 原样传递、stdin、JSON/JSONL、退出码、异步轮询不重放、超时清理抗 TERM
子进程、取消/关闭、UTF-8 截断、搜索空结果与失败、并发/过期、worker 资源超限、
HTTP 报备恢复/注销、回环请求限制以及标准 stdio MCP 连接。

GitHub [CI](https://github.com/scottzx/bash-mcp/actions/workflows/ci.yml) 在 Linux Node 22/24
和 macOS Node 22 上运行检查。发布时更新 `package.json` 和锁文件的版本，提交后推送
对应的 `vX.Y.Z` tag，[发布 workflow](https://github.com/scottzx/bash-mcp/actions/workflows/publish.yml)
会再次检查、测试、校验 tag 版本并发布带 provenance 的公开 npm 包。手动运行默认只验证。
发布 workflow 使用 npm Trusted Publisher：GitHub `scottzx/bash-mcp`、workflow
`publish.yml`，以 OIDC 发布，不保存长期 npm token。首次建立包时可先使用本机 npm
认证发布，再在 npm 包设置中配置对应的 Trusted Publisher 并允许 publish。
