/**
 * Claude Code host (native spawn via the Task tool). Back-compat path.
 */

import { readStopIdentity } from './identity.js';
import type { SpawnContext, TeamHostAdapter } from './types.js';

export const claudeAdapter: TeamHostAdapter = {
  id: 'claude',
  kind: 'native',
  protocolLines(): string[] {
    return ['Use the Ruflo MCP tools team_send / team_inbox for handoffs.'];
  },
  plan(ctx: SpawnContext): Record<string, unknown> {
    return {
      taskType: ctx.defaults.claudeTaskType || ctx.role,
      note: 'optional back-compat path via Task tool',
    };
  },
  stopIdentity(payload: unknown, env: NodeJS.ProcessEnv = process.env) {
    return readStopIdentity(
      payload,
      ['subagentName', 'agentName', 'agent', 'agent_type', 'description', 'toolInput.description'],
      env.SUBAGENT_NAME,
    );
  },
};
