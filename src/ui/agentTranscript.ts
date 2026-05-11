const ANSI_RE =
  // eslint-disable-next-line no-control-regex
  /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

const HORIZONTAL_RE = /[─━═╌╍╼╾⎯]/g;
const HORIZONTAL_ONLY_RE = /^[─━═╌╍╼╾⎯\s]+$/;
const BARE_PROMPT_RE = /^[❯>›→]\s*$/;

export function agentTranscriptTail(text: string, maxLines: number): string {
  const lines = sanitizeAgentTranscript(text).split("\n");
  return lines.slice(-maxLines).join("\n");
}

export function sanitizeAgentTranscript(text: string): string {
  return text
    .replace(ANSI_RE, "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => !isTerminalChromeLine(line))
    .join("\n")
    .trimEnd();
}

function isTerminalChromeLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (BARE_PROMPT_RE.test(trimmed)) return true;
  if (trimmed.length >= 8 && HORIZONTAL_ONLY_RE.test(trimmed)) return true;
  if (isAgentStatusLine(trimmed)) return true;
  if (/^scroll\s+J\/K\b.*\?\s+help$/i.test(trimmed)) return true;

  const horizontalCount = (trimmed.match(HORIZONTAL_RE) ?? []).length;
  if (horizontalCount < 8) return false;
  const withoutRules = trimmed.replace(HORIZONTAL_RE, "").trim();
  return withoutRules.length === 0 || isAgentStatusLine(withoutRules);
}

function isAgentStatusLine(line: string): boolean {
  if (!line.includes(" | ")) return false;
  return (
    /\bgit:[^\s|]+/.test(line) ||
    /\b(Opus|Sonnet|Haiku|Claude|Codex|GPT|Gemini|Llama)\b/i.test(line)
  );
}
