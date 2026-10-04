export function result(data, failed = data.success === false) {
  return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data, ...(failed ? { isError: true } : {}) };
}

export function errorResult(error, code = 'INVALID_ARGUMENT') {
  return result({ success: false, code, error: error instanceof Error ? error.message : String(error) });
}

export function parseOutput(stdout, format, truncated = false) {
  if (format === 'text') return { output_format: 'text' };
  if (truncated) return format === 'auto' ? { output_format: 'text' } : { output_format: format, parse_error: 'Output was truncated; increase max_output_bytes or narrow the query.' };
  try {
    if (format === 'jsonl') {
      return { output_format: 'jsonl', data: stdout.split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line)) };
    }
    return { output_format: 'json', data: JSON.parse(stdout) };
  } catch (error) {
    return format === 'auto' ? { output_format: 'text' } : { output_format: format, parse_error: error.message };
  }
}
