const string = (description) => ({ type: 'string', description });
const integer = (minimum, maximum, description) => ({ type: 'integer', minimum, maximum, description });
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const jobId = string('Job ID returned by bash.exec or bash.search. Jobs live in this service process and expire after 10 minutes.');
const wait = integer(0, 1000, 'Wait up to this many milliseconds before returning. Default 800; commands continue as jobs.');
export const methods = {
  'bash.exec': {
    description: 'Execute on this node using Bash or an argv array. Returns complete output or a running job ID. Each call has an independent shell. Commands have the service account’s host permissions.',
    parameters: object({
      command: string('Bash command. Supply exactly one of command or argv.'),
      argv: { type: 'array', minItems: 1, maxItems: 256, items: { type: 'string' }, description: 'Executable and literal arguments; no shell interpolation.' },
      cwd: string('Working directory, absolute or relative to the configured default directory.'),
      stdin: string('Text written to stdin, then stdin is closed.'),
      timeout_ms: integer(1, 300000, 'Total execution deadline, default 30000 ms.'),
      wait_ms: wait,
      output_format: { type: 'string', enum: ['auto', 'text', 'json', 'jsonl'], description: 'Default auto: parse a JSON document when possible. json/jsonl require valid complete output.' },
      max_output_bytes: integer(1024, 1048576, 'Maximum returned bytes per output stream; default 65536. Truncation is explicit.'),
    }),
  },
  'bash.job_get': { description: 'Get a job’s state and structured result. Use this to poll long commands; polling never re-executes them.', parameters: object({ job_id: jobId, wait_ms: wait }, ['job_id']) },
  'bash.job_cancel': { description: 'Cancel a running job and terminate its process group.', parameters: object({ job_id: jobId }, ['job_id']) },
  'bash.jobs': { description: 'List retained job IDs and states without large command output.', parameters: object({}) },
  'bash.search': {
    description: 'Search files on this node using ripgrep and return JSON matches with path, line_number, text, and submatches. No shell interpolation. No matches is a successful empty list.',
    parameters: object({
      pattern: string('Search pattern; treated literally by default.'),
      path: string('File or directory, default configured cwd.'),
      regex: { type: 'boolean', description: 'Use a regular expression instead of a literal pattern.' },
      ignore_case: { type: 'boolean' }, hidden: { type: 'boolean' },
      glob: { type: 'array', maxItems: 32, items: { type: 'string' }, description: 'ripgrep glob filters, e.g. ["*.ts", "!node_modules/**"].' },
      max_matches: integer(1, 1000, 'Maximum returned matches and maximum matches per file, default 100.'),
      timeout_ms: integer(1, 300000, 'Total search deadline, default 10000 ms.'), wait_ms: wait,
    }, ['pattern']),
  },
  'bash.info': { description: 'Inspect the node’s platform, default cwd, runner version, search availability, and limits.', parameters: object({}) },
};
