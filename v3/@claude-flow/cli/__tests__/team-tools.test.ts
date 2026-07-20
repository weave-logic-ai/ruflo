/**
 * ADR-320 team_* MCP tools smoke tests
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { teamTools } from '../src/mcp-tools/team-tools.js';

function tool(name: string) {
  const t = teamTools.find((x) => x.name === name);
  if (!t) throw new Error(`missing tool ${name}`);
  return t;
}

describe('teamTools (ADR-320)', () => {
  let cwd: string;
  let prev: string | undefined;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'ruflo-team-'));
    prev = process.env.CLAUDE_FLOW_CWD;
    process.env.CLAUDE_FLOW_CWD = cwd;
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.CLAUDE_FLOW_CWD;
    else process.env.CLAUDE_FLOW_CWD = prev;
    rmSync(cwd, { recursive: true, force: true });
  });

  it('create → plan → spawn → send → inbox → on_stop → shutdown', async () => {
    const create = await tool('team_create').handler({
      name: 'demo',
      topology: 'hierarchical',
      maxAgents: 4,
      host: 'grok',
    });
    expect(create.success).toBe(true);
    expect(existsSync(join(cwd, '.claude-flow', 'teams', 'demo', 'team.json'))).toBe(true);

    const plan = await tool('team_plan').handler({
      team: 'demo',
      steps: ['architect', 'developer'],
    });
    expect(plan.success).toBe(true);

    const spawn = await tool('team_spawn').handler({
      team: 'demo',
      agent: 'architect',
      role: 'architect',
      prompt: 'Design the feature',
      next: ['developer'],
    });
    expect(spawn.success).toBe(true);
    expect((spawn as { spawnPlan?: { host?: { grok?: { isolation?: string } } } }).spawnPlan?.host?.grok)
      .toBeTruthy();
    expect(
      (spawn as { spawnPlan: { host: { grok: { capability_mode: string } } } }).spawnPlan.host.grok
        .capability_mode,
    ).toBe('read-only');

    const send = await tool('team_send').handler({
      team: 'demo',
      to: 'developer',
      from: 'architect',
      summary: 'design',
      message: 'Use layered architecture',
    });
    expect(send.success).toBe(true);

    // register developer so broadcast targets work
    await tool('team_spawn').handler({
      team: 'demo',
      agent: 'developer',
      role: 'developer',
      prompt: 'Implement',
    });

    const inbox = await tool('team_inbox').handler({
      team: 'demo',
      agent: 'developer',
      peek: true,
    });
    expect(inbox.success).toBe(true);
    expect((inbox as { messages: unknown[] }).messages.length).toBeGreaterThanOrEqual(1);

    const onStop = await tool('team_on_stop').handler({ team: 'demo', agent: 'architect' });
    expect(onStop.success).toBe(true);
    expect((onStop as { assign?: { agent?: string } }).assign?.agent).toBe('developer');

    const status = await tool('team_status').handler({ team: 'demo' });
    expect(status.success).toBe(true);

    const shutdown = await tool('team_shutdown').handler({ team: 'demo' });
    expect(shutdown.success).toBe(true);
    const team = JSON.parse(
      readFileSync(join(cwd, '.claude-flow', 'teams', 'demo', 'team.json'), 'utf-8'),
    );
    expect(team.status).toBe('shutdown');
  });

  it('rejects invalid team names', async () => {
    const bad = await tool('team_create').handler({ name: '../evil' });
    expect(bad.success).toBe(false);
  });
});
