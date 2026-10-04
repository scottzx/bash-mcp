// Reuse the upstream runner, without starting its MCP daemon or duplicating it.
import { parentPort, workerData } from 'node:worker_threads';
import { runProcess } from 'mcp-server-commands/build/run_process.js';

function clip(value, limit) {
  const buffer = Buffer.from(value);
  // Omit an incomplete UTF-8 sequence at the byte boundary.
  if (buffer.length <= limit) return { text: value, bytes: buffer.length, truncated: false };
  let end = limit;
  while (end > 0 && (buffer[end] & 0xc0) === 0x80) end--;
  return { text: buffer.subarray(0, end).toString('utf8'), bytes: buffer.length, truncated: true };
}

try {
  const { argv, cwd, stdin, timeout_ms, max_output_bytes } = workerData;
  // The parent owns the deadline and process group cleanup. The upstream timer
  // remains a fallback, including when the parent is temporarily busy.
  const execution = runProcess({ argv, cwd, stdin_text: stdin, timeout_ms: timeout_ms + 5000 });
  parentPort.postMessage({ type: 'started', pid: execution.pid ?? null });
  const response = await execution;
  const fields = Object.fromEntries(response.content.filter((block) => block.type === 'text').map((block) => [block.name, block.text]));
  const stdout = clip(fields.STDOUT ?? '', max_output_bytes);
  const stderr = clip(fields.STDERR ?? '', max_output_bytes);
  const exitCode = /^-?\d+$/.test(fields.EXIT_CODE ?? '') ? Number(fields.EXIT_CODE) : null;
  parentPort.postMessage({ type: 'result', data: {
    success: !response.isError && exitCode === 0,
    exit_code: exitCode, signal: fields.SIGNAL ?? null,
    stdout: stdout.text, stderr: stderr.text,
    stdout_bytes: stdout.bytes, stderr_bytes: stderr.bytes,
    truncated: stdout.truncated || stderr.truncated,
    stdout_truncated: stdout.truncated, stderr_truncated: stderr.truncated,
    ...(fields.ERROR || fields.MESSAGE || (exitCode === null && fields.EXIT_CODE)
      ? { error: fields.ERROR ?? fields.MESSAGE ?? fields.EXIT_CODE } : {}),
  } });
} catch (error) {
  parentPort.postMessage({ type: 'error', error: error.message });
}
parentPort.close();
