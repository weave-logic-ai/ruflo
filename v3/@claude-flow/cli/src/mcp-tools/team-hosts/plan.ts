/**
 * Spawn-plan assembly: the shared, host-neutral child protocol plus one
 * entry per requested host from that host's adapter.
 */

import { getProjectCwd } from '../types.js';
import { resolveHost } from './index.js';
import { roleDefaults, type SpawnContext, type TeamHostAdapter } from './types.js';

interface PlanTeam {
  id: string;
  name: string;
  host?: string;
}

/** Shared, host-neutral protocol text plus the adapter's own lines. */
function buildProtocol(ctx: SpawnContext, adapter: TeamHostAdapter): string {
  const target = ctx.next.length ? ctx.next.join(', ') : 'the team lead';
  const handoff = adapter.kind === 'exec'
    ? `Your final reply is delivered to ${target} as your handoff. End with a complete summary of what you did and what ${target} needs next.`
    : `Before you finish, send your handoff to ${target} with team_send. Your final reply goes to the lead.`;
  return [
    `You are "${ctx.agent}" (role: ${ctx.role}) on team "${ctx.team.name}".`,
    ...adapter.protocolLines(ctx),
    adapter.kind === 'exec'
      ? `Messages queued for you are included below. If the Ruflo MCP tools are available, team_inbox (team=${ctx.team.name}, agent=${ctx.agent}) shows anything newer.`
      : `Read your inbox first: team_inbox (team=${ctx.team.name}, agent=${ctx.agent}).`,
    ctx.next.length ? `Next agent(s): ${ctx.next.join(', ')}` : 'Next: report completion to the team lead.',
    handoff,
    '',
    'Task:',
    ctx.task || `(No task body — wait for inbox / lead instructions for role ${ctx.role}.)`,
  ].join('\n');
}

/** Build spawnPlan.host[<label>] for every requested host. Throws TeamHostsError. */
export function buildSpawnPlan(
  team: PlanTeam,
  agent: string,
  role: string,
  task: string,
  next: string[],
  hostLabels: string[],
  model?: string,
): Record<string, unknown> {
  const host: Record<string, Record<string, unknown>> = {};
  for (const label of hostLabels) {
    const { adapter, hostConfig } = resolveHost(label, getProjectCwd());
    const ctx: SpawnContext = {
      team, agent, role, defaults: roleDefaults(role), next, task, label, model, hostConfig,
    };
    host[label] = { ...adapter.plan(ctx), prompt: buildProtocol(ctx, adapter) };
  }
  const primary = team.host && host[team.host] ? team.host : hostLabels[0];
  return { teamId: team.id, name: agent, role, prompt: host[primary].prompt, next, host };
}

export function stringList(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof raw === 'string') return raw.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

