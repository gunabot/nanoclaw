/**
 * Agent Runner for NanoClaw (Linux / no-container mode)
 *
 * Phase 1 Linux adaptation: replace Apple Container execution with a direct
 * Node.js child process spawn of the agent-runner package.
 *
 * IPC stays file-based and per-group (DATA_DIR/ipc/<group>/...).
 */

import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import pino from 'pino';
import {
  CONTAINER_TIMEOUT,
  CONTAINER_MAX_OUTPUT_SIZE,
  GROUPS_DIR,
  DATA_DIR,
  AGENT_RUNTIME,
  type AgentRuntime
} from './config.js';
import { RegisteredGroup } from './types.js';
import { validateAdditionalMounts } from './mount-security.js';
import { runCodexAgent } from './codex-runner.js';
import { getSetting } from './db.js';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: { target: 'pino-pretty', options: { colorize: true } }
});

// Sentinel markers for robust output parsing (must match agent-runner)
const OUTPUT_START_MARKER = '---NANOCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCLAW_OUTPUT_END---';

function getHomeDir(): string {
  const home = process.env.HOME || os.homedir();
  if (!home) {
    throw new Error('Unable to determine home directory: HOME environment variable is not set and os.homedir() returned empty');
  }
  return home;
}

export interface ContainerInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
}

export interface ContainerOutput {
  status: 'success' | 'error';
  result: string | null;
  newSessionId?: string;
  error?: string;
}

interface VolumeMount {
  hostPath: string;
  containerPath: string;
  readonly?: boolean;
}

/**
 * Best-effort extra mount exposure without containers:
 * We validate requested mounts against an external allowlist, then expose them
 * into the group working directory under `extra/` via symlinks.
 *
 * NOTE: readonly cannot be enforced without OS support; Phase 1 keeps the
 * validation step and exposes paths for convenience.
 */
function exposeExtraMounts(groupDir: string, mounts: VolumeMount[]): void {
  const extraPrefix = '/workspace/extra/';
  for (const mount of mounts) {
    if (!mount.containerPath.startsWith(extraPrefix)) continue;

    const rel = mount.containerPath.slice(extraPrefix.length);
    const targetPath = path.join(groupDir, 'extra', rel);

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });

    try {
      // If target exists already, skip
      if (fs.existsSync(targetPath)) continue;
      fs.symlinkSync(mount.hostPath, targetPath, 'dir');
    } catch (err) {
      logger.warn({ hostPath: mount.hostPath, targetPath, err }, 'Failed to expose extra mount via symlink');
    }
  }
}

function buildExtraMounts(group: RegisteredGroup, isMain: boolean): VolumeMount[] {
  const mounts: VolumeMount[] = [];

  if (group.containerConfig?.additionalMounts) {
    const validatedMounts = validateAdditionalMounts(
      group.containerConfig.additionalMounts,
      group.name,
      isMain
    );
    mounts.push(...validatedMounts);
  }

  return mounts;
}

function getAgentRunnerEntrypoint(): string {
  const projectRoot = process.cwd();
  // Built output from container/agent-runner package
  return path.join(projectRoot, 'container', 'agent-runner', 'dist', 'index.js');
}

function loadAllowedEnvFromDotenv(projectRoot: string): Record<string, string> {
  const envFile = path.join(projectRoot, '.env');
  if (!fs.existsSync(envFile)) return {};

  // Only expose specific auth variables needed by Claude tooling.
  const allowedVars = ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY'];
  const envContent = fs.readFileSync(envFile, 'utf-8');

  const out: Record<string, string> = {};
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (allowedVars.includes(key) && value) out[key] = value;
  }
  return out;
}

function getAgentRuntime(group: RegisteredGroup): AgentRuntime {
  // Priority: per-group config > database setting > env var > default
  const groupRuntime = group.containerConfig?.env?.AGENT_RUNTIME as AgentRuntime | undefined;
  if (groupRuntime) return groupRuntime;

  // Hot-swappable: check database setting
  const dbRuntime = getSetting('agent_runtime') as AgentRuntime | null;
  if (dbRuntime && (dbRuntime === 'claude' || dbRuntime === 'codex')) return dbRuntime;

  return AGENT_RUNTIME || 'claude';
}

export async function runContainerAgent(
  group: RegisteredGroup,
  input: ContainerInput
): Promise<ContainerOutput> {
  const startTime = Date.now();

  const projectRoot = process.cwd();
  const groupDir = path.join(GROUPS_DIR, group.folder);
  fs.mkdirSync(groupDir, { recursive: true });

  // Per-group IPC namespace
  const groupIpcDir = path.join(DATA_DIR, 'ipc', group.folder);
  fs.mkdirSync(path.join(groupIpcDir, 'messages'), { recursive: true });
  fs.mkdirSync(path.join(groupIpcDir, 'tasks'), { recursive: true });

  const runtime = getAgentRuntime(group);

  // Per-group HOME (for per-group Claude sessions isolation)
  const groupHomeDir = path.join(DATA_DIR, 'sessions', group.folder);
  const groupClaudeDir = path.join(groupHomeDir, '.claude');
  fs.mkdirSync(groupClaudeDir, { recursive: true });

  // Additional mounts (validated) exposed under groupDir/extra/*
  const extraMounts = buildExtraMounts(group, input.isMain);
  exposeExtraMounts(groupDir, extraMounts);

  const logsDir = path.join(groupDir, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });

  // If configured, run Codex CLI directly (no Claude Agent SDK).
  if (runtime === 'codex') {
    logger.info({ group: group.name, isMain: input.isMain, cwd: groupDir }, 'Running Codex runtime');

    // Bind environment expected by Codex runner
    process.env.NANOCLAW_GROUP_DIR = groupDir;
    process.env.NANOCLAW_IPC_DIR = groupIpcDir;

    return await runCodexAgent(group, input);
  }

  const agentEntrypoint = getAgentRunnerEntrypoint();
  if (!fs.existsSync(agentEntrypoint)) {
    return {
      status: 'error',
      result: null,
      error: `Agent runner not built: missing ${agentEntrypoint}. Run: npm --prefix container/agent-runner run build`
    };
  }

  logger.info({
    group: group.name,
    isMain: input.isMain,
    cwd: groupDir,
    ipcDir: groupIpcDir
  }, 'Spawning direct agent runner (Claude)');

  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...loadAllowedEnvFromDotenv(projectRoot),
    ...group.containerConfig?.env,

    // Claude runner uses per-group HOME for session isolation.
    HOME: groupHomeDir,

    // Tell runner where the workspace lives in no-container mode
    NANOCLAW_GROUP_DIR: groupDir,
    NANOCLAW_IPC_DIR: groupIpcDir,

    // Explicit runtime selection
    AGENT_RUNTIME: 'claude'
  };

  return new Promise((resolve) => {
    const proc = spawn(process.execPath, [agentEntrypoint], {
      cwd: groupDir,
      env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;

    proc.stdin.write(JSON.stringify(input));
    proc.stdin.end();

    proc.stdout.on('data', (data) => {
      if (stdoutTruncated) return;
      const chunk = data.toString();
      const remaining = CONTAINER_MAX_OUTPUT_SIZE - stdout.length;
      if (chunk.length > remaining) {
        stdout += chunk.slice(0, remaining);
        stdoutTruncated = true;
        logger.warn({ group: group.name, size: stdout.length }, 'Agent stdout truncated due to size limit');
      } else {
        stdout += chunk;
      }
    });

    proc.stderr.on('data', (data) => {
      const chunk = data.toString();
      const lines = chunk.trim().split('\n');
      for (const line of lines) {
        if (line) logger.debug({ agent: group.folder }, line);
      }

      if (stderrTruncated) return;
      const remaining = CONTAINER_MAX_OUTPUT_SIZE - stderr.length;
      if (chunk.length > remaining) {
        stderr += chunk.slice(0, remaining);
        stderrTruncated = true;
        logger.warn({ group: group.name, size: stderr.length }, 'Agent stderr truncated due to size limit');
      } else {
        stderr += chunk;
      }
    });

    const timeout = setTimeout(() => {
      logger.error({ group: group.name }, 'Agent timeout, killing');
      proc.kill('SIGKILL');
      resolve({
        status: 'error',
        result: null,
        error: `Agent timed out after ${CONTAINER_TIMEOUT}ms`
      });
    }, group.containerConfig?.timeout || CONTAINER_TIMEOUT);

    proc.on('close', (code) => {
      clearTimeout(timeout);
      const duration = Date.now() - startTime;

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const logFile = path.join(logsDir, `agent-${timestamp}.log`);
      const isVerbose = process.env.LOG_LEVEL === 'debug' || process.env.LOG_LEVEL === 'trace';

      const logLines = [
        `=== Agent Run Log ===`,
        `Timestamp: ${new Date().toISOString()}`,
        `Group: ${group.name}`,
        `IsMain: ${input.isMain}`,
        `Duration: ${duration}ms`,
        `Exit Code: ${code}`,
        `Stdout Truncated: ${stdoutTruncated}`,
        `Stderr Truncated: ${stderrTruncated}`,
        ``
      ];

      if (isVerbose) {
        logLines.push(
          `=== Input ===`,
          JSON.stringify(input, null, 2),
          ``,
          `=== Entrypoint ===`,
          agentEntrypoint,
          ``,
          `=== CWD ===`,
          groupDir,
          ``,
          `=== Stderr${stderrTruncated ? ' (TRUNCATED)' : ''} ===`,
          stderr,
          ``,
          `=== Stdout${stdoutTruncated ? ' (TRUNCATED)' : ''} ===`,
          stdout
        );
      } else {
        logLines.push(
          `=== Input Summary ===`,
          `Prompt length: ${input.prompt.length} chars`,
          `Session ID: ${input.sessionId || 'new'}`,
          ``
        );

        if (code !== 0) {
          logLines.push(
            `=== Stderr (last 500 chars) ===`,
            stderr.slice(-500),
            ``
          );
        }
      }

      fs.writeFileSync(logFile, logLines.join('\n'));
      logger.debug({ logFile, verbose: isVerbose }, 'Agent log written');

      if (code !== 0) {
        logger.error({
          group: group.name,
          code,
          duration,
          stderr: stderr.slice(-500),
          logFile
        }, 'Agent exited with error');

        resolve({
          status: 'error',
          result: null,
          error: `Agent exited with code ${code}: ${stderr.slice(-200)}`
        });
        return;
      }

      try {
        // Extract JSON between sentinel markers for robust parsing
        const startIdx = stdout.indexOf(OUTPUT_START_MARKER);
        const endIdx = stdout.indexOf(OUTPUT_END_MARKER);

        let jsonLine: string;
        if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
          jsonLine = stdout.slice(startIdx + OUTPUT_START_MARKER.length, endIdx).trim();
        } else {
          // Fallback: last non-empty line (backwards compatibility)
          const lines = stdout.trim().split('\n');
          jsonLine = lines[lines.length - 1];
        }

        const output: ContainerOutput = JSON.parse(jsonLine);

        logger.info({
          group: group.name,
          duration,
          status: output.status,
          hasResult: !!output.result
        }, 'Agent completed');

        resolve(output);
      } catch (err) {
        logger.error({
          group: group.name,
          stdout: stdout.slice(-500),
          error: err
        }, 'Failed to parse agent output');

        resolve({
          status: 'error',
          result: null,
          error: `Failed to parse agent output: ${err instanceof Error ? err.message : String(err)}`
        });
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      logger.error({ group: group.name, error: err }, 'Agent spawn error');
      resolve({
        status: 'error',
        result: null,
        error: `Agent spawn error: ${err.message}`
      });
    });
  });
}

export function writeTasksSnapshot(
  groupFolder: string,
  isMain: boolean,
  tasks: Array<{
    id: string;
    groupFolder: string;
    prompt: string;
    schedule_type: string;
    schedule_value: string;
    status: string;
    next_run: string | null;
  }>
): void {
  // Write filtered tasks to the group's IPC directory
  const groupIpcDir = path.join(DATA_DIR, 'ipc', groupFolder);
  fs.mkdirSync(groupIpcDir, { recursive: true });

  // Main sees all tasks, others only see their own
  const filteredTasks = isMain
    ? tasks
    : tasks.filter(t => t.groupFolder === groupFolder);

  const tasksFile = path.join(groupIpcDir, 'current_tasks.json');
  fs.writeFileSync(tasksFile, JSON.stringify(filteredTasks, null, 2));
}

export interface AvailableGroup {
  jid: string;
  name: string;
  lastActivity: string;
  isRegistered: boolean;
}

/**
 * Write available groups snapshot for the agent to read.
 * Only main group can see all available groups (for activation).
 * Non-main groups only see their own registration status.
 */
export function writeGroupsSnapshot(
  groupFolder: string,
  isMain: boolean,
  groups: AvailableGroup[],
  registeredJids: Set<string>
): void {
  const groupIpcDir = path.join(DATA_DIR, 'ipc', groupFolder);
  fs.mkdirSync(groupIpcDir, { recursive: true });

  // Main sees all groups; others see nothing (they can't activate groups)
  const visibleGroups = isMain ? groups : [];

  const groupsFile = path.join(groupIpcDir, 'available_groups.json');
  fs.writeFileSync(groupsFile, JSON.stringify({
    groups: visibleGroups,
    lastSync: new Date().toISOString()
  }, null, 2));
}
