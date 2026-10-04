# Third-party notices

The terminal runner is reused, without vendoring or modifying its source, from
`mcp-server-commands@0.8.2`, https://github.com/g0t4/mcp-server-commands (MIT).
Its npm package includes this license:

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the “Software”), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

MCP client/server protocol support uses `@modelcontextprotocol/sdk@1.30.0`
(MIT), https://github.com/modelcontextprotocol/typescript-sdk.
The runner's SDK dependency is overridden to the same version to avoid shipping
another legacy SDK. Its `runProcess` module uses Node built-ins and its own
message helpers; it does not start its upstream MCP server in this adapter.

Bash and ripgrep are external executables provided by the target device and
are not bundled in this package. Their licenses remain with their respective
distributions. npm dependencies retain their original license files.
