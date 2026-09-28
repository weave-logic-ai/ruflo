/**
 * `ruflo team run` and `ruflo team hook-stop` (ADR-402).
 *
 * The runner executes a member's stored exec plan (Codex or a command host)
 * as one headless process. Process exit is the stop signal: the runner
 * writes a run file, delivers the final message to the next agent (or the
 * lead), and calls team_on_stop. No host hook is needed on this path.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { getProjectCwd } from './types.js';
import { getAdapter, type ExecSpec } from './team-hosts/index.js';
import {
  ensureDir,
  loadTeam,
  safeName,
  saveTeam,
  teamDir,
  teamsRoot,
  withTeamLock,
  writeJson,
} from './team-store.js';
import { teamTools } from './team-tools.js';

export const DEFAULT_RUN_TIMEOUT_MS = 1_800_000;
export const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576;
const HANDOFF_MAX_CHARS = 64 * 1024;
const TIMEOUT_EXIT_CODE = 124;

export interface TeamRunOptions {
  team: string;
  agent: string;
  host?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  dryRun?: boolean;
  /** Resolves {mcpServer} for Codex plans. Defaults to `codex mcp list --json`. */
  resolveMcpServer?: () => string | undefined;
}

export interface TeamRunResult {
  success: boolean;
  exitCode: number;
  error?: string;
  dryRun?: { command: string; args: string[]; cwd: string; passEnvNames: string[]; promptVia: string; inboxMessages: number };
  runId?: string;
  runFile?: string;
  outcome?: 'done' | 'failed';
  reason?: string;
  warnings?: string[];
  onStop?: unknown;
}

interface InboxMessage {
  id: string;
  from: string;
  type: string;
  summary?: string;
  content: string;
  timestamp?: string;
}

async function readInbox(team: string, agent: string, peek: boolean): Promise<InboxMessage[]> {
  const r = (await tool('team_inbox').handler({ team, agent, peek })) as { success?: boolean; messages?: InboxMessage[] };
  return r.success && Array.isArray(r.messages) ? r.messages : [];
}

/**
 * Put queued messages in a delimited block before the task. The task body
 * starts at the last "Task:" line of the protocol; without one the block is
 * appended.
 */
export function withMessages(prompt: string, messages: InboxMessage[]): string {
  if (!messages.length) return prompt;
  const lines = [`=== Messages for you (${messages.length}, oldest first; already removed from your inbox) ===`];
  for (const m of messages) {
    lines.push(`--- from ${m.from} · ${m.type}${m.summary ? ` · ${m.summary}` : ''} ---`, m.content);
  }
  lines.push('=== End of messages ===');
  const block = lines.join('\n');
  const at = prompt.lastIndexOf('\nTask:\n');
  return at < 0 ? `${prompt}\n\n${block}` : `${prompt.slice(0, at)}\n${block}\n${prompt.slice(at)}`;
}

interface ExecPlanEntry {
  kind: 'exec';
  exec: ExecSpec;
  prompt?: string;
  events?: string;
}

function tool(name: string) {
  const t = teamTools.find((x) => x.name === name);
  if (!t) throw new Error(`${name} not registered`);
  return t;
}

function fail(error: string, exitCode = 1): TeamRunResult {
  return { success: false, exitCode, error };
}

function isExecEntry(v: unknown): v is ExecPlanEntry {
  const e = v as ExecPlanEntry;
  return !!e && typeof e === 'object' && e.kind === 'exec' && !!e.exec
    && typeof e.exec.command === 'string' && Array.isArray(e.exec.args);
}

/** First enabled `ruflo` or `claude-flow` server in `codex mcp list --json`. */
export function codexMcpServer(): string | undefined {
  try {
    const r = spawnSync('codex', ['mcp', 'list', '--json'], { encoding: 'utf-8', timeout: 15_000 });
    if (r.status !== 0 || !r.stdout) return undefined;
    const list = JSON.parse(r.stdout) as Array<{ name?: string; enabled?: boolean }>;
    for (const want of ['ruflo', 'claude-flow']) {
      if (list.some((s) => s.name === want && s.enabled !== false)) return want;
    }
  } catch {
    /* codex missing or output not JSON */
  }
  return undefined;
}

/**
 * Fill placeholders in one argument in a single pass, so text substituted
 * from the prompt is never rescanned. A placeholder written as "{name}"
 * inside a larger argument gets a JSON-quoted value (valid TOML for
 * `codex -c key="value"`, including Windows paths).
 */
export function fillPlaceholders(arg: string, vars: Record<string, string>): string {
  return arg.replace(/"\{([A-Za-z]+)\}"|\{([A-Za-z]+)\}/g, (m, quoted: string, bare: string) => {
    const key = quoted || bare;
    if (!(key in vars)) return m;
    return quoted ? JSON.stringify(vars[key]) : vars[key];
  });
}

interface CodexEvents {
  threadId?: string;
  terminal?: 'turn.completed' | 'turn.failed';
  failure?: string;
  lastMessage?: string;
  /** `server.tool` names of MCP calls the child made. */
  mcpTools?: string[];
}

/** Read the `codex exec --json` stream. Lines that are not JSON are ignored. */
export function parseCodexEvents(stdout: string): CodexEvents {
  const out: CodexEvents = {};
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let ev: Record<string, any>;
    try {
      ev = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (ev.type === 'thread.started' && typeof ev.thread_id === 'string') out.threadId = ev.thread_id;
    if (ev.type === 'turn.completed') out.terminal = 'turn.completed';
    if (ev.type === 'turn.failed') {
      out.terminal = 'turn.failed';
      out.failure = String(ev.error?.message ?? 'turn.failed');
    }
    if (ev.type === 'item.completed' && ev.item?.type === 'agent_message' && typeof ev.item.text === 'string') {
      out.lastMessage = ev.item.text;
    }
    if (ev.type === 'item.completed' && ev.item?.type === 'mcp_tool_call' && typeof ev.item.tool === 'string') {
      (out.mcpTools ??= []).push(`${ev.item.server ?? '?'}.${ev.item.tool}`);
    }
  }
  return out;
}

export async function runTeamAgent(opts: TeamRunOptions): Promise<TeamRunResult> {
  const st = safeName(String(opts.team || ''), 'team');
  if (!st.ok) return fail(st.error);
  const sa = safeName(String(opts.agent || ''), 'agent');
  if (!sa.ok) return fail(sa.error);
  const teamName = st.value;
  const agent = sa.value;

  const { team, error } = loadTeam(teamName);
  if (error) return fail(error);
  if (!team) return fail(`Team "${teamName}" not found`);
  const member = team.members[agent];
  if (!member) return fail(`Agent "${agent}" is not registered on team "${teamName}" — call team_spawn first`);
  const label = opts.host || team.host || '';
  const entry = member.spawn?.[label];
  if (!isExecEntry(entry)) {
    return fail(
      `Agent "${agent}" has no exec plan for host "${label}". Exec hosts are codex and command hosts; ` +
        `re-run team_spawn with hosts:["${label}"] (plans from older Ruflo versions are not runnable).`,
    );
  }

  const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const root = getProjectCwd();
  const runsDir = join(teamDir(teamName), 'runs');
  const resultFile = join(runsDir, `${agent}-${runId}.last.txt`);
  const runFile = join(runsDir, `${agent}-${runId}.json`);
  const basePrompt = String(entry.prompt ?? '');
  const warnings: string[] = [];

  const vars: Record<string, string> = {
    team: teamName,
    agent,
    role: member.role,
    cwd: root,
    teamRoot: root,
    resultFile,
  };
  let rawArgs = [...entry.exec.args];
  if (rawArgs.some((a) => a.includes('{mcpServer}'))) {
    const server = (opts.resolveMcpServer ?? codexMcpServer)();
    if (server) {
      vars.mcpServer = server;
    } else {
      // Drop the `-c mcp_servers.{mcpServer}...` pair; the child still runs.
      rawArgs = rawArgs.filter((a, i) => !a.includes('{mcpServer}') && !(a === '-c' && rawArgs[i + 1]?.includes('{mcpServer}')));
      warnings.push('mcpServerNotFound');
    }
  }
  const { command, promptVia, passEnv } = entry.exec;

  if (opts.dryRun) {
    // Peek only: a dry run shows the queued messages but leaves them queued.
    const queued = await readInbox(teamName, agent, true);
    const args = rawArgs.map((a) => fillPlaceholders(a, { ...vars, prompt: withMessages(basePrompt, queued) }));
    return {
      success: true,
      exitCode: 0,
      dryRun: { command, args, cwd: root, passEnvNames: [...(passEnv ?? [])], promptVia, inboxMessages: queued.length },
      warnings,
    };
  }

  const dual = await import('@claude-flow/codex/dual-mode').catch(() => undefined);
  if (!dual || typeof dual.runHeadlessProcess !== 'function') {
    return fail('`ruflo team run` needs a newer @claude-flow/codex (runHeadlessProcess is missing)');
  }

  // Exec children may have no Ruflo MCP (or a sandbox that blocks it), so the
  // runner drains the member's inbox (archived, as team_inbox does) and
  // delivers the queued messages in the prompt.
  const delivered = await readInbox(teamName, agent, false);
  const prompt = withMessages(basePrompt, delivered);
  const args = rawArgs.map((a) => fillPlaceholders(a, { ...vars, prompt }));

  await withTeamLock(teamName, () => {
    const cur = loadTeam(teamName).team;
    if (!cur?.members[agent]) return;
    cur.members[agent].status = 'running';
    cur.members[agent].runId = runId;
    saveTeam(cur);
  });

  ensureDir(runsDir);
  const env = dual.buildWorkerEnvironment(process.env, { principalId: `agent:${agent}`, passEnv });
  env.CLAUDE_FLOW_CWD = root;
  const startedAt = new Date().toISOString();
  let code: number | null = null;
  let timedOut = false;
  let ms = 0;
  let stdout = '';
  let stderr = '';
  let spawnError: string | undefined;
  try {
    const r = await dual.runHeadlessProcess({
      command,
      args,
      cwd: root,
      env,
      stdinText: promptVia === 'stdin' ? prompt : undefined,
      timeoutMs: opts.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS,
      maxOutputBytes: opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
    });
    ({ code, timedOut, ms, stdout, stderr } = r);
  } catch (err) {
    spawnError = err instanceof Error ? err.message : String(err);
  }

  const events = entry.events === 'codex-jsonl' ? parseCodexEvents(stdout) : undefined;
  let text = existsSync(resultFile) ? readFileSync(resultFile, 'utf-8') : '';
  if (!text.trim()) text = events ? events.lastMessage ?? '' : stdout;
  if (!existsSync(resultFile)) writeFileSync(resultFile, text, 'utf-8');

  let reason: string | undefined;
  if (spawnError) reason = `could not start ${command}: ${spawnError}`;
  else if (timedOut) reason = `timed out after ${opts.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS}ms`;
  else if (code !== 0) reason = `exit code ${code}${stderr.trim() ? `: ${stderr.trim().slice(-500)}` : ''}`;
  else if (events?.terminal === 'turn.failed') reason = events.failure;
  const outcome: 'done' | 'failed' = reason === undefined ? 'done' : 'failed';
  if (events && outcome === 'done' && !events.terminal) warnings.push('noTerminalEvent');

  writeJson(runFile, {
    runId,
    team: teamName,
    agent,
    host: label,
    startedAt,
    code,
    timedOut,
    ms,
    outcome,
    ...(reason ? { reason } : {}),
    resultFile: relative(root, resultFile),
    ...(events?.threadId ? { threadId: events.threadId } : {}),
    ...(events ? { mcpTools: events.mcpTools ?? [] } : {}),
    inboxDelivered: delivered.map((m) => m.id),
    warnings,
  });

  if (events?.threadId) {
    await withTeamLock(teamName, () => {
      const cur = loadTeam(teamName).team;
      if (!cur?.members[agent]) return;
      cur.members[agent].threadId = events.threadId;
      saveTeam(cur);
    });
  }

  // A failed run goes to the lead only; the next step is not ready.
  const targets = outcome === 'done' && member.next?.length ? member.next : ['lead'];
  const body = text.trim()
    ? text.length > HANDOFF_MAX_CHARS ? `${text.slice(0, HANDOFF_MAX_CHARS)}\n…(truncated)` : text
    : `(no final message${reason ? `; ${reason}` : ''})`;
  for (const to of targets) {
    const sent = await tool('team_send').handler({
      team: teamName,
      to,
      from: agent,
      type: 'result',
      summary: `${agent} ${outcome}`,
      message: `${body}\n\n[run: ${relative(root, runFile)}]`,
    });
    if (!(sent as { success?: boolean }).success) warnings.push(`sendFailed:${to}`);
  }

  const onStop = await tool('team_on_stop').handler({ team: teamName, agent, outcome, runId, reason });
  const exitCode = code === 0 && outcome === 'done' ? 0 : timedOut ? TIMEOUT_EXIT_CODE : code || 1;
  return {
    success: outcome === 'done',
    exitCode,
    runId,
    runFile: relative(root, runFile),
    outcome,
    reason,
    warnings,
    onStop,
  };
}

/** Names of teams whose status is active. */
function activeTeams(): string[] {
  const dir = teamsRoot();
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => {
    try {
      const t = JSON.parse(readFileSync(join(dir, n, 'team.json'), 'utf-8'));
      return t && t.status === 'active';
    } catch {
      return false;
    }
  });
}

export interface HookStopResult {
  handled: boolean;
  reason?: string;
  team?: string;
  agent?: string;
  onStop?: unknown;
}

/**
 * Map a native stop-hook payload to team_on_stop. Team resolution: payload,
 * then TEAM_NAME, then the only active team. With several active teams and
 * no explicit team it does nothing rather than guess.
 */
export async function hookStop(host: string, payload: unknown, env: NodeJS.ProcessEnv = process.env): Promise<HookStopResult> {
  const id = getAdapter(host).stopIdentity(payload, env);
  if (!id.agent) return { handled: false, reason: 'no agent in payload' };
  let team = id.team || env.TEAM_NAME;
  if (!team) {
    const active = activeTeams();
    if (active.length !== 1) {
      return { handled: false, reason: active.length ? 'several active teams and none named' : 'no active team', agent: id.agent };
    }
    team = active[0];
  }
  const onStop = await tool('team_on_stop').handler({ team, agent: id.agent, outcome: id.outcome });
  return { handled: (onStop as { success?: boolean }).success === true, team, agent: id.agent, onStop };
}
