/**
 * `ruflo team` — non-MCP interface to the host-agnostic Agent Teams bus
 * (ADR-320).
 *
 *   team <verb> --params '<json>'   call a team_* handler in-process, print JSON
 *   team run --team T --agent A     run a member's exec plan (Codex, command host)
 *   team hook-stop --host H         native stop hook → team_on_stop (always exits 0)
 */

import type { Command, CommandContext, CommandResult } from '../types.js';

const VERBS: Record<string, string> = {
  create: 'team_create',
  spawn: 'team_spawn',
  send: 'team_send',
  inbox: 'team_inbox',
  broadcast: 'team_broadcast',
  plan: 'team_plan',
  status: 'team_status',
  'on-stop': 'team_on_stop',
  shutdown: 'team_shutdown',
};

function printJson(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}

function verbCommand(verb: string, toolName: string): Command {
  return {
    name: verb,
    description: `Call ${toolName} with --params JSON and print the result`,
    options: [
      { name: 'params', description: 'Tool input as a JSON object', type: 'string', default: '{}' },
    ],
    action: async (ctx: CommandContext): Promise<CommandResult> => {
      let input: Record<string, unknown>;
      try {
        const raw = ctx.flags.params;
        input = typeof raw === 'string' ? JSON.parse(raw) : {};
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('not an object');
      } catch (err) {
        printJson({ success: false, error: `--params must be a JSON object (${err instanceof Error ? err.message : String(err)})` });
        return { success: false, exitCode: 1 };
      }
      const { teamTools } = await import('../mcp-tools/team-tools.js');
      const t = teamTools.find((x) => x.name === toolName);
      if (!t) {
        printJson({ success: false, error: `${toolName} not registered` });
        return { success: false, exitCode: 1 };
      }
      let result: Record<string, unknown>;
      try {
        result = (await t.handler(input)) as Record<string, unknown>;
      } catch (err) {
        result = { success: false, error: err instanceof Error ? err.message : String(err) };
      }
      printJson(result);
      return result.success === false ? { success: false, exitCode: 1 } : { success: true };
    },
  };
}

const runCommand: Command = {
  name: 'run',
  description: "Run a registered member's exec plan (codex exec or a command host) and advance the team",
  options: [
    { name: 'team', description: 'Team name', type: 'string', required: true },
    { name: 'agent', description: 'Agent name (registered with team_spawn)', type: 'string', required: true },
    { name: 'host', description: 'Host label (default: the team host)', type: 'string' },
    { name: 'timeout', description: 'Timeout in ms (default 1800000)', type: 'number' },
    { name: 'max-output', description: 'Max captured stdout/stderr bytes (default 1048576)', type: 'number' },
    { name: 'dry-run', description: 'Print the resolved command and exit without running it', type: 'boolean' },
    { name: 'json', description: 'Print the full result as JSON', type: 'boolean' },
  ],
  examples: [
    { command: 'ruflo team run --team demo --agent reviewer --host codex', description: 'Run one Codex turn for "reviewer"' },
    { command: 'ruflo team run --team demo --agent reviewer --dry-run', description: 'Show the argv without running it' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { runTeamAgent } = await import('../mcp-tools/team-runner.js');
    const f = ctx.flags;
    const num = (v: unknown) => (typeof v === 'number' && v > 0 ? v : undefined);
    const result = await runTeamAgent({
      team: String(f.team ?? ''),
      agent: String(f.agent ?? ''),
      host: f.host === undefined ? undefined : String(f.host),
      timeoutMs: num(f.timeout),
      maxOutputBytes: num(f.maxOutput),
      dryRun: f.dryRun === true,
    });
    if (f.json || f.dryRun || result.error) {
      printJson(result.dryRun ? { ...result.dryRun, warnings: result.warnings } : result);
    } else {
      process.stdout.write(
        `${result.outcome}: ${result.runFile}${result.reason ? ` (${result.reason})` : ''}\n`,
      );
    }
    return result.success ? { success: true } : { success: false, exitCode: result.exitCode || 1 };
  },
};

function readStdin(capMs: number): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('');
    let data = '';
    const done = () => { clearTimeout(t); process.stdin.pause(); resolve(data); };
    const t = setTimeout(done, capMs);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', done);
    process.stdin.on('error', done);
  });
}

const hookStopCommand: Command = {
  name: 'hook-stop',
  description: 'Stop-hook entry point: read the hook JSON on stdin and call team_on_stop. Always exits 0.',
  options: [
    { name: 'host', description: 'Host id whose payload shape to read (grok, claude, codex, command)', type: 'string', default: 'claude' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    try {
      const raw = await readStdin(300);
      let payload: unknown = {};
      try {
        payload = raw.trim() ? JSON.parse(raw) : {};
      } catch {
        payload = {};
      }
      const { hookStop } = await import('../mcp-tools/team-runner.js');
      const r = await hookStop(String(ctx.flags.host || 'claude'), payload);
      if (process.env.RUFLO_TEAM_HOOK_DEBUG) printJson(r);
    } catch {
      /* fail-open: a hook must never block the host */
    }
    return { success: true };
  },
};

export const teamCommand: Command = {
  name: 'team',
  description: 'Host-agnostic Agent Teams bus (ADR-320): call team_* handlers, run exec hosts, handle stop hooks',
  subcommands: [
    ...Object.entries(VERBS).map(([verb, toolName]) => verbCommand(verb, toolName)),
    runCommand,
    hookStopCommand,
  ],
  examples: [
    { command: `ruflo team create --params '{"name":"demo","host":"codex"}'`, description: 'Create a team' },
    { command: 'ruflo team run --team demo --agent reviewer', description: 'Run a Codex or command-host member' },
    { command: 'ruflo team hook-stop --host grok', description: 'Stop-hook entry (reads hook JSON on stdin)' },
  ],
};

export default teamCommand;
