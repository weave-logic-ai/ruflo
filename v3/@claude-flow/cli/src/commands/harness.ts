/**
 * Live harness status.
 *
 * This is not `doctor` and not `status`. Those describe install health or
 * call tool handlers inside this process. `harness` reports what is already
 * running for this working tree: the host session, a live daemon pid, MCP
 * servers whose cwd is this tree, processes holding the memory database
 * open, and teams that have not shut down.
 *
 *   ruflo harness
 *   ruflo harness --json
 *   ruflo harness --hook     # SessionStart payload for Codex (and Claude)
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Command, CommandContext, CommandResult } from '../types.js';

export interface LiveHarness {
  host: string;
  parent: { pid: number; command: string };
  session: Record<string, string>;
  daemon: { state: 'live' | 'down' | 'stale'; pid?: number };
  mcp: Array<{ pid: number; command: string }>;
  memory: { openPids: number[] };
  teams: Array<{ name: string; status: string; members: number }>;
  line: string;
}

function alive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function execOut(cmd: string, args: string[], timeout = 2500): string {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

function parentCommand(): string {
  return execOut('ps', ['-p', String(process.ppid), '-o', 'comm=']).trim();
}

function detectHost(parent: string): string {
  const env = process.env;
  if (env.WEFTOS_SESSION || env.WEFT_SESSION || /weftos/i.test(parent)) return 'weftos';
  if (env.GROK_SESSION_ID || env.GROK_WORKSPACE_ROOT || /(^|\/)grok$/.test(parent)) return 'grok';
  if (env.CODEX_THREAD_ID || env.CODEX_SANDBOX || env.CODEX_CI || /(^|\/)codex$/.test(parent)) return 'codex';
  if (env.CLAUDECODE || env.CLAUDE_CODE_ENTRYPOINT || /(^|\/)claude$/.test(parent)) return 'claude';
  return parent ? `process:${parent}` : 'unknown';
}

function sessionIds(): Record<string, string> {
  const keys = ['GROK_SESSION_ID', 'CODEX_THREAD_ID', 'CLAUDE_SESSION_ID', 'WEFTOS_SESSION', 'WEFT_SESSION'];
  const out: Record<string, string> = {};
  for (const key of keys) {
    const value = process.env[key];
    if (value) out[key] = value;
  }
  return out;
}

function processCwd(pid: number): string {
  const out = execOut('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']);
  const line = out.split('\n').find((row) => row.startsWith('n'));
  return line ? line.slice(1) : '';
}

function mcpServers(root: string): Array<{ pid: number; command: string }> {
  const out = execOut('ps', ['-ax', '-o', 'pid=,command=']);
  const found: Array<{ pid: number; command: string }> = [];
  for (const line of out.split('\n')) {
    if (!/mcp(\s|$).*start|ruflo.*\bmcp\b|claude-flow.*\bmcp\b/.test(line)) continue;
    const pid = Number(line.trim().split(/\s+/)[0]);
    if (!alive(pid) || pid === process.pid) continue;
    const cwd = processCwd(pid);
    const command = line.trim().replace(/^\d+\s+/, '');
    if (cwd === root || command.includes(root)) found.push({ pid, command: command.slice(0, 160) });
  }
  return found;
}

function memoryHolders(root: string): number[] {
  const db = join(root, '.swarm', 'memory.db');
  if (!existsSync(db)) return [];
  const out = execOut('lsof', ['-t', db]);
  return [...new Set(out.split('\n').map((row) => Number(row.trim())).filter(alive))];
}

function daemonState(root: string): LiveHarness['daemon'] {
  const pidFile = join(root, '.claude-flow', 'daemon.pid');
  if (!existsSync(pidFile)) return { state: 'down' };
  const pid = Number(readFileSync(pidFile, 'utf8').trim());
  if (!alive(pid)) return { state: 'stale', pid };
  return { state: 'live', pid };
}

function liveTeams(root: string): LiveHarness['teams'] {
  const dir = join(root, '.claude-flow', 'teams');
  if (!existsSync(dir)) return [];
  const teams: LiveHarness['teams'] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    try {
      const raw = JSON.parse(readFileSync(join(dir, file), 'utf8')) as {
        name?: string;
        status?: string;
        shutdownAt?: string;
        members?: Record<string, unknown>;
      };
      if (raw.shutdownAt || raw.status === 'shutdown' || raw.status === 'stopped') continue;
      teams.push({
        name: raw.name || file.replace(/\.json$/, ''),
        status: raw.status || 'unknown',
        members: raw.members ? Object.keys(raw.members).length : 0,
      });
    } catch {
      /* unreadable team file is not a live team */
    }
  }
  return teams;
}

function workspaceRoot(): string {
  const fromEnv = process.env.GROK_WORKSPACE_ROOT || process.env.CLAUDE_PROJECT_DIR || process.env.CODEX_PROJECT_DIR;
  if (fromEnv) return fromEnv;
  const top = execOut('git', ['rev-parse', '--show-toplevel']).trim();
  return top || process.cwd();
}

export function collectLiveHarness(root = workspaceRoot()): LiveHarness {
  const parent = { pid: process.ppid, command: parentCommand() };
  const host = detectHost(parent.command);
  const daemon = daemonState(root);
  const mcp = mcpServers(root);
  const memory = { openPids: memoryHolders(root) };
  const teams = liveTeams(root);
  const live = daemon.state === 'live' || mcp.length > 0 || memory.openPids.length > 0 || teams.length > 0;
  const parts = [
    'harness',
    live ? 'live' : 'idle',
    `host=${host}`,
    parent.command ? `parent=${parent.command}` : '',
    `daemon=${daemon.state}${daemon.pid ? `:${daemon.pid}` : ''}`,
    `mcp=${mcp.length}`,
    `memory-open=${memory.openPids.length}`,
    `teams=${teams.length}`,
  ].filter(Boolean);
  return {
    host,
    parent,
    session: sessionIds(),
    daemon,
    mcp,
    memory,
    teams,
    line: parts.join(' │ '),
  };
}

function printText(report: LiveHarness): void {
  process.stdout.write(`${report.line}\n`);
  if (Object.keys(report.session).length) {
    process.stdout.write(`session ${Object.entries(report.session).map(([k, v]) => `${k}=${v}`).join(' ')}\n`);
  }
  for (const server of report.mcp) process.stdout.write(`mcp ${server.pid} ${server.command}\n`);
  if (report.memory.openPids.length) process.stdout.write(`memory held by ${report.memory.openPids.join(',')}\n`);
  for (const team of report.teams) process.stdout.write(`team ${team.name} ${team.status} members=${team.members}\n`);
}

export const harnessCommand: Command = {
  name: 'harness',
  description: 'Show the running harness for this tree (live pids and open state, not install config)',
  options: [
    { name: 'json', description: 'Print the live report as JSON', type: 'boolean', default: false },
    {
      name: 'hook',
      description: 'Print a SessionStart additionalContext payload for Codex or Claude',
      type: 'boolean',
      default: false,
    },
  ],
  examples: [
    { command: 'ruflo harness', description: 'One line plus any live mcp, memory holders, and teams' },
    { command: 'ruflo harness --json', description: 'Machine-readable live report' },
    { command: 'ruflo harness --hook', description: 'SessionStart payload' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const report = collectLiveHarness();
    if (ctx.flags.hook) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: report.line,
        },
      }) + '\n');
    } else if (ctx.flags.json) {
      process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    } else {
      printText(report);
    }
    return { success: true, data: report };
  },
};

export default harnessCommand;
