---
name: bash-mcp
description: 通过 DreamMate 能力网络在指定节点执行 Bash/argv 命令、查询或取消长任务，并以 JSON 结构化搜索文件。需要跨项目或跨节点终端操作且目标服务已报备时使用。
---

# DreamMate Bash 终端

先调用 `dreammate_list_services(keyword="bash", node="all")` 发现节点与服务，再用
`dreammate_inspect(service_id="bash", node="目标节点", method="bash.exec")` 查看契约。
目标服务 ID 可能由部署方自定义，以发现结果为准。通过 `dreammate_invoke` 调用，不需要 SSH。

## 执行命令

```json
{"node":"scott-mac","service_id":"bash","method":"bash.exec","params":{"command":"git status --short","cwd":"/absolute/project/path","output_format":"text"}}
```

每次调用使用独立 Bash，不保留前次 `cd`、`export` 或 shell 变量。通过 `cwd` 指定目录；
同一命令内可使用管道、重定向和环境变量。动态参数优先使用 `argv`，避免拼接进 shell：

```json
{"service_id":"bash","method":"bash.exec","params":{"argv":["git","status","--porcelain=v1"],"cwd":"/absolute/project/path"}}
```

执行身份是服务宿主账号，具有该账号的主机权限，`cwd` 不是沙箱或目录权限限制。
只执行用户已授权的操作；有歧义或调用超时时先核对任务状态，不自动重放命令。

## 长任务

`bash.exec` / `bash.search` 最多等待 1000 ms，未完成则返回 `status="running"` 和 `job_id`。
这表示执行已开始，不能重复提交。使用 `bash.job_get` 查询同一任务：

```json
{"service_id":"bash","method":"bash.job_get","params":{"job_id":"返回的 ID","wait_ms":1000}}
```

完成时返回 `status="completed"`、`success`、`exit_code`、`stdout`、`stderr`；
超时/取消分别返回 `timed_out` / `cancelled`。检查 `isError` 和 `structuredContent.success`。
`bash.job_cancel` 取消并终止进程组，`bash.jobs` 列出本进程保留任务。
结果默认保留 10 分钟；服务重启会终止任务并清空记录，出现 `JOB_NOT_FOUND` 时先核对实际影响。

## JSON 与文件搜索

`output_format="json"` 解析一个 JSON 文档，`"jsonl"` 解析每行 JSON，数据位于
`structuredContent.data`；默认 `"auto"` 尝试 JSON，失败则保留文本。显式格式解析失败
会有 `parse_error`，即使命令执行成功也会返回 `isError`。不要把解析错误理解成命令没有执行。
输出截断时 `truncated=true`，不会把截断 JSON 当完整数据解析；可缩小查询或提高
`max_output_bytes`（每路输出最多 1 MiB，默认 64 KiB）。

```json
{"service_id":"bash","method":"bash.search","params":{"pattern":"TODO","path":"/absolute/project/path","glob":["*.ts","!node_modules/**"],"max_matches":100}}
```

搜索依赖目标节点安装 `rg`。默认按字面匹配，`regex=true` 启用正则。结果在
`structuredContent.matches`，包含 `path`、`line_number`、`text`、`submatches`，位置为字节偏移。
非 UTF-8 数据保留 `path_data` / `text_data` / `match_data` 中的 base64 表示。
没有匹配是 `success=true, matches=[]`；错误和超时不能当作没有匹配。
`truncated=true` 表示结果有上限，不能据此断定项目中只有返回的这些匹配。
此工具搜索节点文件内容；搜索网络数据使用已有搜索工具，得到的 JSON 可经 `bash.exec`
的 `stdin` 交给 `jq` / Python 处理，无需额外 SSH 或终端连接。
