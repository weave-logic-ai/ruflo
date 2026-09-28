/**
 * Grok Build host (native spawn via spawn_subagent). Checked against
 * Grok Build 1.0.41.
 */

import { readStopIdentity } from './identity.js';
import type { SpawnContext, TeamHostAdapter } from './types.js';

/** Spawn arguments Grok Build 1.0.41 actually accepts on spawn_subagent. */
export function grokSpawnArgs(role: string, agentName: string, isolation: string): Record<string, unknown> {
  return {
    description: `${role}:${agentName}`,
    background: true,
    isolation,
  };
}

export function roleConstraint(mode: string, isolation: string): string {
  if (mode === 'read-only') {
    return 'Constraint: do not create, edit, delete, or move files, and do not run commands that change the repo. Read, search, and report.';
  }
  if (isolation === 'worktree') {
    return 'Constraint: Grok isolates your edits in a git worktree. Stay inside that worktree and report its path when you finish.';
  }
  return 'Constraint: report results to the team lead. Stay inside the files this task names.';
}

export const grokAdapter: TeamHostAdapter = {
  id: 'grok',
  kind: 'native',
  protocolLines(ctx: SpawnContext): string[] {
    return [
      'Grok Build 1.0.41 runs you as a general-purpose subagent. Nesting depth is 1: do not call spawn_subagent.',
      roleConstraint(ctx.defaults.capability_mode, ctx.defaults.isolation),
      'Host-agnostic Agent Teams bus (ADR-320). There is no Claude SendMessage tool.',
      'Prefer Ruflo MCP team_send / team_inbox when available; CLI fallback:',
      `  node scripts/grok-team-bus.mjs send --team ${ctx.team.name} --to <next> --summary "<short>" --message "<handoff>"`,
      `Or store under memory namespace team:${ctx.team.name}.`,
    ];
  },
  plan(ctx: SpawnContext): Record<string, unknown> {
    const { defaults } = ctx;
    return {
      // Checked against Grok Build 1.0.41. Pass `spawn` to spawn_subagent
      // together with `prompt`. Leave `advisory` on the plan.
      contract: 'grok-build-1.0.41',
      spawn: grokSpawnArgs(ctx.role, ctx.agent, defaults.isolation),
      advisory: {
        capability_mode: defaults.capability_mode,
        subagent_type: defaults.subagent_type,
        note: 'Grok Build 1.0.41 does not take capability_mode or subagent_type on spawn_subagent. The child is general-purpose; the prompt carries the constraint. isolation is the enforced knob. .grok/agents/*.md are session profiles (grok --agent-profile), not spawn types.',
      },
    };
  },
  stopIdentity(payload: unknown, env: NodeJS.ProcessEnv = process.env) {
    return readStopIdentity(
      payload,
      ['subagentName', 'agentName', 'agent', 'description', 'toolInput.description'],
      env.SUBAGENT_NAME,
    );
  },
};
