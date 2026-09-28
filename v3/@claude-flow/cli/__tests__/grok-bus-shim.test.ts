/**
 * The shipped Grok CLI bus is a shim over `ruflo team <verb> --params`.
 * Running a sequence through the shim must leave the same team.json as
 * running it through the handlers directly (timestamps dropped).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { teamTools } from '../src/mcp-tools/team-tools.js';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHIM = join(PKG, 'templates', 'grok', 'scripts', 'grok-team-bus.mjs');
const CLI = join(PKG, 'bin', 'cli.js');
const built = existsSync(join(PKG, 'dist', 'src', 'commands', 'team.js'));

function tool(name: string) {
  const t = teamTools.find((x) => x.name === name);
  if (!t) throw new Error(`missing tool ${name}`);
  return t;
}

function stripTimes(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripTimes);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).filter(([k]) => !k.endsWith('At')).map(([k, x]) => [k, stripTimes(x)]),
    );
  }
  return v;
}

describe.skipIf(!built)('grok-team-bus.mjs shim', () => {
  let viaShim: string;
  let viaHandlers: string;
  let prev: string | undefined;

  beforeEach(() => {
    viaShim = mkdtempSync(join(tmpdir(), 'ruflo-shim-'));
    viaHandlers = mkdtempSync(join(tmpdir(), 'ruflo-handlers-'));
    prev = process.env.CLAUDE_FLOW_CWD;
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.CLAUDE_FLOW_CWD;
    else process.env.CLAUDE_FLOW_CWD = prev;
    rmSync(viaShim, { recursive: true, force: true });
    rmSync(viaHandlers, { recursive: true, force: true });
  });

  function shim(...args: string[]) {
    const r = spawnSync(process.execPath, [SHIM, ...args, '--root', viaShim], {
      encoding: 'utf8',
      env: { ...process.env, RUFLO_CLI: CLI },
      timeout: 60_000,
    });
    expect(r.status, r.stderr + r.stdout).toBe(0);
    return JSON.parse(r.stdout);
  }

  it('create → plan → spawn → send → inbox → on-stop → status matches the handlers', async () => {
    expect(shim('create', '--name', 'demo').ok).toBe(true);
    shim('plan', '--team', 'demo', '--steps', '["architect","developer"]');
    shim('spawn', '--team', 'demo', '--agent', 'architect', '--role', 'architect', '--prompt', 'Design', '--next', 'developer');
    shim('send', '--team', 'demo', '--to', 'developer', '--from', 'architect', '--message', 'Use layers');
    const inbox = shim('inbox', '--team', 'demo', '--agent', 'developer');
    expect(inbox.messages).toHaveLength(1);
    const stop = shim('on-stop', '--team', 'demo', '--agent', 'architect');
    expect(stop.assign.agent).toBe('developer');
    const status = shim('status', '--team', 'demo');
    expect(status.team.plan.index).toBe(1);

    process.env.CLAUDE_FLOW_CWD = viaHandlers;
    await tool('team_create').handler({ name: 'demo', host: 'grok' });
    await tool('team_plan').handler({ team: 'demo', steps: ['architect', 'developer'] });
    await tool('team_spawn').handler({ team: 'demo', agent: 'architect', role: 'architect', prompt: 'Design', next: ['developer'] });
    await tool('team_send').handler({ team: 'demo', to: 'developer', from: 'architect', message: 'Use layers' });
    await tool('team_inbox').handler({ agent: 'developer' });
    await tool('team_on_stop').handler({ team: 'demo', agent: 'architect' });

    const read = (root: string) =>
      JSON.parse(readFileSync(join(root, '.claude-flow', 'teams', 'demo', 'team.json'), 'utf-8'));
    const a = read(viaShim);
    expect(a.schemaVersion).toBe(1);
    expect(stripTimes(a)).toEqual(stripTimes(read(viaHandlers)));
  }, 120_000);
});
