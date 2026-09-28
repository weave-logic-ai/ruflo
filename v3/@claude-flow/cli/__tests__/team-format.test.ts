/**
 * Canonical team.json format: v0 data written by the original CLI bus is
 * read and normalized, the first write stamps schemaVersion 1 without
 * losing fields, and a newer schemaVersion is refused without a write.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { teamTools, TEAM_SCHEMA_VERSION } from '../src/mcp-tools/team-tools.js';
import { runTeamAgent } from '../src/mcp-tools/team-runner.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'team-v0');

function tool(name: string) {
  const t = teamTools.find((x) => x.name === name);
  if (!t) throw new Error(`missing tool ${name}`);
  return t;
}

describe('team.json canonical format', () => {
  let cwd: string;
  let prev: string | undefined;
  const teamFile = () => join(cwd, '.claude-flow', 'teams', 'legacy', 'team.json');
  const readTeam = () => JSON.parse(readFileSync(teamFile(), 'utf-8'));

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'ruflo-team-format-'));
    mkdirSync(join(cwd, '.claude-flow', 'teams', 'legacy'), { recursive: true });
    // The fixture avoids a .claude-flow/ path (gitignored); place it here.
    cpSync(join(FIXTURE, 'team.json'), join(cwd, '.claude-flow', 'teams', 'legacy', 'team.json'));
    cpSync(join(FIXTURE, 'mailbox'), join(cwd, '.claude-flow', 'swarm', 'mailbox'), { recursive: true });
    prev = process.env.CLAUDE_FLOW_CWD;
    process.env.CLAUDE_FLOW_CWD = cwd;
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.CLAUDE_FLOW_CWD;
    else process.env.CLAUDE_FLOW_CWD = prev;
    rmSync(cwd, { recursive: true, force: true });
  });

  it('team_status reads v0 data, normalizing plan steps', async () => {
    const r = await tool('team_status').handler({ team: 'legacy' }) as {
      success: boolean; team: { plan: { steps: Array<Record<string, string>> } }; pendingMail: Record<string, number>;
    };
    expect(r.success).toBe(true);
    expect(r.team.plan.steps[0]).toEqual({ id: 'architect', agent: 'architect', status: 'ready' });
    expect(r.team.plan.steps[1].status).toBe('pending');
    expect(r.pendingMail.developer).toBe(1);
    // Reads never write.
    expect(readTeam().schemaVersion).toBeUndefined();
  });

  it('team_on_stop advances v0 data and stamps schemaVersion 1, keeping unknown keys', async () => {
    const r = await tool('team_on_stop').handler({ team: 'legacy', agent: 'architect' });
    expect(r.success).toBe(true);
    const team = readTeam();
    expect(team.schemaVersion).toBe(TEAM_SCHEMA_VERSION);
    expect(team.plan.index).toBe(1);
    expect(team.plan.steps[1].status).toBe('ready');
    expect(team.extraTopLevel).toEqual({ owner: 'legacy-script' });
    expect(team.members.architect.customNote).toBe('kept by every writer');
    expect(team.members.architect.spawn.grok.subagent_type).toBe('ruflo-architect');
  });

  it('refuses schemaVersion 2 without writing', async () => {
    const newer = { ...readTeam(), schemaVersion: 2 };
    writeFileSync(teamFile(), JSON.stringify(newer));
    const before = readFileSync(teamFile(), 'utf-8');
    for (const [name, input] of [
      ['team_status', { team: 'legacy' }],
      ['team_on_stop', { team: 'legacy', agent: 'architect' }],
      ['team_plan', { team: 'legacy', steps: ['x'] }],
      ['team_spawn', { team: 'legacy', agent: 'x' }],
      ['team_shutdown', { team: 'legacy' }],
    ] as const) {
      const r = await tool(name).handler(input);
      expect(r.success, name).toBe(false);
      expect(String((r as { error: string }).error)).toMatch(/schemaVersion 2/);
    }
    expect(readFileSync(teamFile(), 'utf-8')).toBe(before);
  });

  it('team run refuses the v0 member plan', async () => {
    const r = await runTeamAgent({ team: 'legacy', agent: 'architect' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/no exec plan/);
  });
});
