import { spawn } from 'child_process';
import pino from 'pino';
import { CONTAINER_MAX_OUTPUT_SIZE, CONTAINER_TIMEOUT } from './config.js';
import type { RegisteredGroup } from './types.js';
import type { ContainerInput, ContainerOutput } from './container-runner.js';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: { target: 'pino-pretty', options: { colorize: true } }
});

function buildCodexPrompt(prompt: string): string {
  // Keep instructions short; we rely on NanoClaw’s IPC watcher.
  const ipcDir = process.env.NANOCLAW_IPC_DIR || '$NANOCLAW_IPC_DIR';

  const toolGuide = `

[NANOCLAW IPC TOOLS]
You can interact with NanoClaw by writing JSON files.
- Send a message:
  Write a new file to: ${ipcDir}/messages/
  JSON: {"type":"message","chatJid":"...","text":"..."}
- Schedule/pause/resume/cancel tasks:
  Write a new file to: ${ipcDir}/tasks/
  Examples:
  {"type":"schedule_task","prompt":"...","schedule_type":"cron|interval|once","schedule_value":"...","groupFolder":"main"}
  {"type":"pause_task","taskId":"..."}

Reply with plain text for the user.
`;

  return `${prompt}${toolGuide}`;
}

function extractCodexResponse(rawStdout: string): string {
  const lines = rawStdout
    .split('\n')
    .map(l => l.replace(/\r$/, ''))
    .map(l => l.trimEnd());

  // Preferred: capture everything after the last standalone "codex" role marker.
  let lastCodexIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === 'codex') lastCodexIdx = i;
  }

  if (lastCodexIdx !== -1) {
    const tail = lines
      .slice(lastCodexIdx + 1)
      .map(l => l.trim())
      .filter(l => l && l !== 'tokens used');

    // Codex often repeats the final answer as the last line.
    const last = tail[tail.length - 1];
    if (last) return last;
  }

  // Fallback: last non-empty line.
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i].trim();
    if (!l) continue;
    if (l === 'tokens used') continue;
    return l;
  }

  return '';
}

export async function runCodexAgent(
  group: RegisteredGroup,
  input: ContainerInput,
  opts?: {
    timeoutMs?: number;
  }
): Promise<ContainerOutput> {
  const timeoutMs = opts?.timeoutMs ?? group.containerConfig?.timeout ?? CONTAINER_TIMEOUT;

  return new Promise((resolve) => {
    const args = ['--full-auto', 'exec', buildCodexPrompt(input.prompt)];

    logger.info({ group: group.name, cwd: process.cwd() }, 'Spawning Codex CLI');

    const proc = spawn('codex', args, {
      cwd: process.env.NANOCLAW_GROUP_DIR || process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;

    proc.stdout.on('data', (data) => {
      if (stdoutTruncated) return;
      const chunk = data.toString();
      const remaining = CONTAINER_MAX_OUTPUT_SIZE - stdout.length;
      if (chunk.length > remaining) {
        stdout += chunk.slice(0, remaining);
        stdoutTruncated = true;
      } else {
        stdout += chunk;
      }
    });

    proc.stderr.on('data', (data) => {
      if (stderrTruncated) return;
      const chunk = data.toString();
      const remaining = CONTAINER_MAX_OUTPUT_SIZE - stderr.length;
      if (chunk.length > remaining) {
        stderr += chunk.slice(0, remaining);
        stderrTruncated = true;
      } else {
        stderr += chunk;
      }
    });

    const timeout = setTimeout(() => {
      proc.kill('SIGKILL');
      resolve({
        status: 'error',
        result: null,
        error: `Codex timed out after ${timeoutMs}ms`
      });
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timeout);

      if (code !== 0) {
        resolve({
          status: 'error',
          result: null,
          error: `Codex exited with code ${code}: ${stderr.trim().slice(-500)}`
        });
        return;
      }

      const text = extractCodexResponse(stdout);
      if (!text) {
        resolve({
          status: 'error',
          result: null,
          error: `Codex returned empty output. Stderr: ${stderr.trim().slice(-500)}`
        });
        return;
      }

      resolve({
        status: 'success',
        result: text,
        // Codex CLI does not provide a stable session id to resume.
        newSessionId: undefined
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      resolve({
        status: 'error',
        result: null,
        error: `Failed to spawn codex: ${err.message}`
      });
    });
  });
}
