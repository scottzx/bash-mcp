# 发布验证

2026-10-04，Mac arm64 / Node.js 22.22.1。

- `npm run check` 通过；`npm test` 12/12 通过。
- 安装为 `~/Library/LaunchAgents/work.dreammate.bash-mcp.plist`，`plutil -lint` 通过。
- HTTP 服务 `127.0.0.1:7785`；本机 DreamMate 网关 `127.0.0.1:36908`。
- `dreammate_list_services(keyword="bash")` 返回 `scott-mac / bash`，`liveness=up`。
- `dreammate_inspect` 可取得执行、搜索和任务查询的 JSON Schema。
- 经 `dreammate_invoke(bash.exec)` 执行 `uname -s`，返回 `Darwin`、退出码 0。
- 经 `dreammate_invoke(bash.search)` 搜索 `src/contracts.mjs`，返回 2 条结构化匹配，含行号与字节位置。
- 经网关执行 `sleep 16` 后输出 JSON，初次调用只用 4 ms 返回 running job；
  `bash.job_get` 返回 completed，实际执行 16217 ms，退出码 0，
  `data={"long_job":true,"via":"dreammate"}`。超过网关 15 秒转发期限的任务验证成功。
- 从 `/private/tmp` 使用已有 DreamMate 0.8.1 源码构建 CLI，通过本机网关调用此服务，
  成功返回 `data={"from_other_project":true}`。本机全局 0.7.2 无 `cli` 子命令，
  现有网关与 MCP 工具仍可正常使用本服务；没有修改该全局安装。
- `dreammate_download_skill(install=false)` 成功返回配套 `bash-mcp/SKILL.md` 包。
- 全网发现可见 Mac 上的此服务。部分其他节点网关不可达，扫描标记 `partial=true`；
  本次只在 Mac 发布服务，没有向其他设备安装。没有进行另一台设备发起的端到端调用验证。
- Linux systemd unit 生成已检查转义；本次未在 Linux/WSL 实机安装。
- `npm pack` 成功生成 `1agents-bash-mcp-0.1.0.tgz`。公共 npm registry 尚未发布。

完整使用方式和限制见 [README.md](../README.md)。
