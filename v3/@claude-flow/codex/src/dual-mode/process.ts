/**
 * Headless process helpers shared by the dual-mode orchestrator and the
 * CLI team runner (`ruflo team run`).
 *
 * Both run one non-interactive agent turn (`codex exec`, `claude -p`, or a
 * custom command host) as a child process with bounded output, a timeout,
 * and a stripped environment. Neither uses a shell.
 */

import { spawn, ChildProcess } from 'child_process';

export interface HeadlessProcessOptions {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Written to stdin before it is closed. stdin is always closed (#2947). */
  stdinText?: string;
  timeoutMs: number;
  maxOutputBytes: number;
  /** Called once the child is spawned, so callers can track or kill it. */
  onSpawn?: (proc: ChildProcess) => void;
}

export interface HeadlessProcessResult {
  /** Exit code, or null when the process was killed by a signal or timed out. */
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  ms: number;
}

/**
 * Spawn a command, feed it optional stdin, close stdin, and collect bounded
 * output. Resolves with the exit code instead of rejecting on a non-zero
 * exit. On timeout the child gets SIGTERM and the promise resolves at once
 * with `timedOut: true`. Rejects only when the process cannot be spawned.
 */
export function runHeadlessProcess(opts: HeadlessProcessOptions): Promise<HeadlessProcessResult> {
  const { command, args, cwd, env, stdinText, timeoutMs, maxOutputBytes } = opts;
  const started = Date.now();

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const proc = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });

    // #2947: `codex exec` blocks until stdin reaches EOF, so the pipe is
    // always closed, after the prompt when one is sent this way.
    proc.stdin?.on('error', () => { /* child exited before reading stdin */ });
    if (stdinText !== undefined) proc.stdin?.write(stdinText);
    proc.stdin?.end();

    opts.onSpawn?.(proc);

    proc.stdout?.on('data', (data) => {
      if (stdout.length < maxOutputBytes) stdout += data.toString().slice(0, maxOutputBytes - stdout.length);
    });
    proc.stderr?.on('data', (data) => {
      if (stderr.length < maxOutputBytes) stderr += data.toString().slice(0, maxOutputBytes - stderr.length);
    });

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      settle(() => resolve({ code: null, stdout, stderr, timedOut: true, ms: Date.now() - started }));
    }, timeoutMs);

    proc.on('close', (code) => {
      settle(() => resolve({ code, stdout, stderr, timedOut: false, ms: Date.now() - started }));
    });
    proc.on('error', (err) => {
      settle(() => reject(err));
    });
  });
}

export interface WorkerEnvironmentOptions {
  principalId: string;
  dbPath?: string;
  /** Serialized into CLAUDE_FLOW_CAPABILITY_ENVELOPE when given. */
  envelope?: unknown;
  /** Names copied back from `base` after the sensitive-name strip. */
  passEnv?: string[];
}

const SENSITIVE_ENV_NAME = /(?:^|_)(?:API_?KEY|KEY|SECRET|TOKEN|PASSWORD|CREDENTIALS?)$/i;

/**
 * Build a child environment from `base`: drop secrets and policy/identity
 * variables, then set the worker's principal, database path and envelope.
 * Names in `passEnv` (for example a host's own auth key) are re-added from
 * `base` after the strip. Token minting is left to the caller.
 */
export function buildWorkerEnvironment(
  base: NodeJS.ProcessEnv,
  opts: WorkerEnvironmentOptions,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(base)) {
    if (SENSITIVE_ENV_NAME.test(name)
      || name.startsWith('CLAUDE_FLOW_POLICY_')
      || name === 'CLAUDE_FLOW_PRINCIPAL_ID'
      || name === 'CLAUDE_FLOW_MCP_INVOCATION_TOKEN'
      || name === 'CLAUDE_FLOW_MCP_CALLER_PUBKEY') continue;
    env[name] = value;
  }
  env.FORCE_COLOR = '0';
  if (opts.dbPath !== undefined) env.CLAUDE_FLOW_DB_PATH = opts.dbPath;
  env.CLAUDE_FLOW_PRINCIPAL_ID = opts.principalId;
  if (opts.envelope !== undefined) {
    env.CLAUDE_FLOW_CAPABILITY_ENVELOPE = JSON.stringify(opts.envelope);
  }
  for (const name of opts.passEnv ?? []) {
    if (base[name] !== undefined) env[name] = base[name];
  }
  return env;
}
