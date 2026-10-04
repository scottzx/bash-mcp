# 发布验证

2026-10-04，Mac arm64 / Node.js 22.22.1，首次发布验证。

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
- 首次全网发现可见 Mac 上的此服务。部分其他节点网关不可达，扫描标记 `partial=true`；
  当时只在 Mac 发布服务，后续 WSL 部署验证见下文。
- `npm pack` 成功；`@1agents/bash-mcp@0.1.0` 已发布到官方公共 npm registry。
- 从官方 registry 安装到独立临时目录，通过安装包的 stdio MCP 执行 Node 命令，
  返回 `data={"npm_install":true,"cwd":"/private/tmp"}`、退出码 0。
- GitHub 仓库为 `scottzx/bash-mcp`；Linux Node 22/24 与 macOS Node 22 的 CI 全部通过，
  发布 workflow 的 dry run 也已通过。
- npm Trusted Publisher 已保存：GitHub `scottzx/bash-mcp`，workflow `publish.yml`，
  允许 `npm publish`；workflow 使用 OIDC，无需 GitHub npm token Secret。
- `v0.1.1` 已通过 [GitHub 自动发布](https://github.com/scottzx/bash-mcp/actions/runs/37214357142)，
  npm 官方 `latest` 为 `0.1.1`，带 SLSA provenance；[对应 CI](https://github.com/scottzx/bash-mcp/actions/runs/37214357461) 全部通过。
- 远程 `100.75.225.56` 的 DreamMate 网关可达，节点名 `scott-pc-wsl`，
  已有 Twenty CRM 主服务及 reader/writer 三个入口均报告健康；经本机
  `dreammate_invoke(twenty.ping)` 实际调用主服务返回 `ok=true`、HTTP 200。首次检查时尚无 Bash 服务；
  后续配置免密 SSH 后已完成安装与设备检查，见下文。

完整使用方式和限制见 [README.md](../README.md)。

2026-10-05，WSL / Node.js 22.22.1 / systemd 用户服务。

- 首次实机安装发现 `WorkingDirectory` 不接受 argv 式引号，`0.1.2` 修正该字段，
  并按字段分别处理 ExecStart 与 Environment 的美元符号转义。
- 在远程真实 systemd 中创建并执行临时测试服务，目录含中文、空格、百分号、美元符号和引号；
  执行进程返回的 cwd、argv、PATH 均与输入一致；测试服务和临时目录已清理。
- 新增 Linux `systemd-analyze --user verify` 回归验证，检查实际 systemd 解析器，
  macOS 上跳过此 Linux 专用用例。
- `0.1.2` 的 [CI](https://github.com/scottzx/bash-mcp/actions/runs/37215424495) 与
  [OIDC 发布](https://github.com/scottzx/bash-mcp/actions/runs/37215424396) 均成功。
- 从官方 npm registry 安装 `@1agents/bash-mcp@0.1.2` 到
  `/home/scott/.local`；WSL 常驻服务为 `/home/scott/.config/systemd/user/bash-mcp.service`，
  默认 cwd `/home/scott`，ripgrep `/usr/bin/rg`，端口 `127.0.0.1:7785`。
  systemd 用户服务 enabled/active，scott 的 linger 已启用，安装返回 registered=true。
- 经本机 DreamMate MCP 发现 `100.75.225.56 / scott-pc-wsl / bash`，六个方法均可查询。
  初次发现曾超时，重试成功；后续四个注册服务的健康状态均为 up。
- 经本机 MCP 调用 `bash.info` 返回 linux/x64、version=0.1.2、search.available=true。
- 经本机 MCP 调用 `bash.search` 搜索已安装包 README，返回 3 条 JSON 匹配，含行号和字节位置。
- 经本机 MCP 调用 `bash.exec` 读取 WSL CPU、内存、磁盘、运行时长、systemd 与容器状态，
  返回完整 JSON、退出码 0。设备检查与搜索均通过 DreamMate 完成。
- 远程 16 秒命令首次调用 1 ms 返回 running job；`bash.job_get` 返回 completed，
  实际执行 16113 ms、退出码 0，`data={"remote_long_job":true,"cwd":"/home/scott"}`。
  远程超过网关单次转发期限的任务验证成功。
