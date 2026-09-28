/**
 * Host-agnostic Agent Teams MCP tools (ADR-402).
 *
 * Comms live in Ruflo (filesystem under .claude-flow/), not host SendMessage.
 * team_spawn returns a spawn plan per host; each host's entry comes from its
 * adapter in ./team-hosts/ (Grok, Claude, Codex, or a command host).
 */

import { existsSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { type MCPTool, getProjectCwd } from './types.js';
import { validateText } from './validate-input.js';
import { normalizeAgentLabel, resolveHost, TeamHostsError } from './team-hosts/index.js';
import { buildSpawnPlan, stringList } from './team-hosts/plan.js';
import {
  ensureDir,
  listMailboxFiles,
  loadTeam,
  mailboxRoot,
  applyStop,
  normalizeStep,
  nowIso,
  readJson,
  safeName,
  saveTeam,
  teamDir,
  teamPath,
  withTeamLock,
  writeJson,
  type TeamMessage,
  type TeamState,
} from './team-store.js';

export {
  TEAM_SCHEMA_VERSION,
  type PlanStep,
  type TeamMember,
  type TeamMessage,
  type TeamState,
} from './team-store.js';

const RUN_ID_RE = /^[A-Za-z0-9_.-]{1,128}$/;

function okResult(data: Record<string, unknown>) {
  return { success: true, ...data };
}

function errResult(error: string) {
  return { success: false, error };
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const teamTools: MCPTool[] = [
  {
    name: 'team_create',
    description:
      'Create a host-agnostic Agent Team (ADR-402). State under .claude-flow/teams/. Use when native SendMessage/Task teammate bus is wrong or unavailable (Grok, Codex, multi-host). Pair with team_spawn for spawn plans and team_send/team_inbox for handoffs.',
    category: 'team',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Team name/id (alphanumeric, dash, underscore)' },
        topology: {
          type: 'string',
          description: 'Team topology (hierarchical, mesh, star, ring)',
        },
        maxAgents: { type: 'number', description: 'Max members (1-50, default 8)' },
        host: {
          type: 'string',
          description: 'Default host label: grok, claude, codex, or a label from .claude-flow/team-hosts.json',
        },
        force: { type: 'boolean', description: 'Overwrite existing team metadata' },
      },
      required: ['name'],
    },
    handler: async (input) => {
      const sn = safeName(String(input.name || ''), 'name');
      if (!sn.ok) return errResult(sn.error);
      const name = sn.value;
      const force = input.force === true;
      const host = (input.host as string) || 'grok';
      try {
        resolveHost(host, getProjectCwd());
      } catch (err) {
        return errResult(errMessage(err));
      }

      return withTeamLock(name, () => {
        if (existsSync(teamPath(name)) && !force) {
          return errResult(`Team "${name}" already exists (pass force=true to overwrite metadata carefully)`);
        }
        ensureDir(join(teamDir(name), 'plan'));
        ensureDir(mailboxRoot());

        const team: TeamState = {
          id: name,
          name,
          topology: (input.topology as string) || 'hierarchical',
          maxAgents: Math.min(Math.max(Number(input.maxAgents) || 8, 1), 50),
          status: 'active',
          createdAt: nowIso(),
          host,
          members: {},
          plan: { steps: [], index: 0 },
        };
        saveTeam(team);
        return okResult({ action: 'create', team });
      });
    },
  },
  {
    name: 'team_spawn',
    description:
      'Register a teammate and return a spawn plan per host (Grok spawn_subagent, Claude Task, Codex exec, or a command host from .claude-flow/team-hosts.json) — does not execute the agent; exec hosts run via `ruflo team run`. Use when native Task has no way to register a teammate into the host-agnostic team roster (ADR-402); the host lead still spawns using the returned plan. Pair with team_create first.',
    category: 'team',
    inputSchema: {
      type: 'object',
      properties: {
        team: { type: 'string', description: 'Team id' },
        agent: { type: 'string', description: 'Agent name' },
        role: { type: 'string', description: 'Role (architect, developer, tester, reviewer, …)' },
        prompt: { type: 'string', description: 'Task body embedded in spawn plan prompt' },
        next: {
          type: 'array',
          description: 'Next agent name(s) for handoff',
          items: { type: 'string' },
        },
        hosts: {
          type: 'array',
          description: 'Host labels to plan for (default: the team host plus claude)',
          items: { type: 'string' },
        },
        model: { type: 'string', description: 'Optional model override for exec hosts that take one (codex -m)' },
      },
      required: ['team', 'agent'],
    },
    handler: async (input) => {
      const st = safeName(String(input.team || ''), 'team');
      if (!st.ok) return errResult(st.error);
      const sa = safeName(String(input.agent || ''), 'agent');
      if (!sa.ok) return errResult(sa.error);
      const role = String(input.role || sa.value);
      const next = stringList(input.next);
      for (const n of next) {
        const sn = safeName(n, 'next');
        if (!sn.ok) return errResult(sn.error);
      }

      if (input.prompt) {
        const tv = validateText(String(input.prompt), 'prompt', 100_000);
        if (!tv.valid) return errResult(tv.error || 'Invalid prompt');
      }
      const model = input.model === undefined ? undefined : String(input.model);

      return withTeamLock(st.value, () => {
        const { team, error } = loadTeam(st.value);
        if (error) return errResult(error);
        if (!team) return errResult(`Team "${st.value}" not found — call team_create first`);

        const requested = stringList(input.hosts);
        const hosts = [...new Set(requested.length ? requested : [team.host || 'grok', 'claude'])];
        let plan: Record<string, unknown>;
        try {
          plan = buildSpawnPlan(team, sa.value, role, String(input.prompt || ''), next, hosts, model);
        } catch (err) {
          if (err instanceof TeamHostsError) return errResult(err.message);
          throw err;
        }
        team.members[sa.value] = {
          ...(team.members[sa.value] || {}),
          name: sa.value,
          role,
          status: 'registered',
          registeredAt: nowIso(),
          next,
          spawn: plan.host as Record<string, unknown>,
        };
        saveTeam(team);
        ensureDir(join(mailboxRoot(), sa.value));
        return okResult({ action: 'spawn', spawnPlan: plan, teamId: team.id });
      });
    },
  },
  {
    name: 'team_send',
    description:
      'Enqueue a message to a named agent mailbox (or broadcast with to="*"). Use when native SendMessage is wrong because the recipient may be on a different host (Grok, Codex) with no SendMessage equivalent — the message persists under .claude-flow/teams/ instead of an in-memory channel. Pair with team_inbox to read it.',
    category: 'team',
    inputSchema: {
      type: 'object',
      properties: {
        team: { type: 'string', description: 'Team id' },
        to: { type: 'string', description: 'Recipient agent name or * for broadcast' },
        message: { type: 'string', description: 'Message body' },
        summary: { type: 'string', description: 'Short summary' },
        from: { type: 'string', description: 'Sender name (default: lead)' },
        type: { type: 'string', description: 'Message type (handoff, status, …)' },
        priority: { type: 'number', description: 'Priority (lower sorts first in filename; default 2)' },
      },
      required: ['team', 'to', 'message'],
    },
    handler: async (input) => {
      const st = safeName(String(input.team || ''), 'team');
      if (!st.ok) return errResult(st.error);
      const { team, error } = loadTeam(st.value);
      if (error) return errResult(error);
      if (!team) return errResult(`Team "${st.value}" not found`);

      const to = String(input.to || '*');
      if (to !== '*') {
        const sto = safeName(to, 'to');
        if (!sto.ok) return errResult(sto.error);
      }
      const content = String(input.message || input.content || '');
      if (!content.trim()) return errResult('message is required');
      const tv = validateText(content, 'message', 500_000);
      if (!tv.valid) return errResult(tv.error || 'Invalid message');

      const from = String(input.from || 'lead');

      const msg: TeamMessage = {
        id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        teamId: team.id,
        from,
        to,
        summary: String(input.summary || ''),
        content,
        type: String(input.type || 'handoff'),
        priority: Number(input.priority ?? 2),
        timestamp: nowIso(),
      };

      const root = mailboxRoot();
      if (to === '*') {
        const members = Object.keys(team.members || {});
        if (members.length === 0) {
          ensureDir(join(root, '_broadcast'));
          writeJson(join(root, '_broadcast', `${msg.priority}_${msg.id}.json`), msg);
        } else {
          for (const m of members) {
            ensureDir(join(root, m));
            writeJson(join(root, m, `${msg.priority}_${msg.id}.json`), msg);
          }
        }
      } else {
        ensureDir(join(root, to));
        writeJson(join(root, to, `${msg.priority}_${msg.id}.json`), msg);
      }
      return okResult({ action: 'send', message: msg });
    },
  },
  {
    name: 'team_inbox',
    description:
      'Drain (default) or peek an agent mailbox. Messages archive under mailbox/<agent>/archive when drained. Use when native SendMessage is wrong because there is no host-agnostic inbox to read from — this is the Grok/Codex-side counterpart to team_send for hosts without a live message channel.',
    category: 'team',
    inputSchema: {
      type: 'object',
      properties: {
        team: { type: 'string', description: 'Team id (optional validation)' },
        agent: { type: 'string', description: 'Agent name whose inbox to read' },
        peek: { type: 'boolean', description: 'If true, do not archive/drain messages' },
      },
      required: ['agent'],
    },
    handler: async (input) => {
      if (input.team) {
        const st = safeName(String(input.team), 'team');
        if (!st.ok) return errResult(st.error);
      }
      const sa = safeName(String(input.agent || ''), 'agent');
      if (!sa.ok) return errResult(sa.error);
      const peek = input.peek === true;
      const dir = join(mailboxRoot(), sa.value);
      if (!existsSync(dir)) {
        return okResult({ action: 'inbox', agent: sa.value, messages: [], peek });
      }
      const files = listMailboxFiles(sa.value);
      const messages: TeamMessage[] = [];
      for (const f of files) {
        const full = join(dir, f);
        const msg = readJson<TeamMessage>(full);
        if (!msg) continue;
        messages.push(msg);
        if (!peek) {
          const archive = join(dir, 'archive');
          ensureDir(archive);
          renameSync(full, join(archive, f));
        }
      }
      return okResult({ action: 'inbox', agent: sa.value, messages, peek });
    },
  },
  {
    name: 'team_broadcast',
    description: 'Fan-out a message to all registered team members (alias of team_send with to="*"). Use when native SendMessage is wrong because it can\'t reach every teammate on a non-Claude host in one call; each recipient reads back via team_inbox on its own host.',
    category: 'team',
    inputSchema: {
      type: 'object',
      properties: {
        team: { type: 'string', description: 'Team id' },
        message: { type: 'string', description: 'Message body' },
        summary: { type: 'string', description: 'Short summary' },
        from: { type: 'string', description: 'Sender (default: lead)' },
      },
      required: ['team', 'message'],
    },
    handler: async (input) => {
      // Delegate via same logic as send with to=*
      const sendTool = teamTools.find((t) => t.name === 'team_send');
      if (!sendTool) return errResult('team_send not registered');
      return sendTool.handler({
        team: input.team,
        to: '*',
        message: input.message,
        summary: input.summary,
        from: input.from || 'lead',
        type: 'broadcast',
      });
    },
  },
  {
    name: 'team_plan',
    description: 'Set pipeline steps for a team (ordered agents); the first step becomes ready. Use when native TodoWrite is wrong because it can\'t drive multi-host agent sequencing — this pipeline advances via team_on_stop instead of a single host\'s task list.',
    category: 'team',
    inputSchema: {
      type: 'object',
      properties: {
        team: { type: 'string', description: 'Team id' },
        steps: {
          type: 'array',
          description: 'Ordered agent names or {id,agent} objects',
          items: {},
        },
      },
      required: ['team', 'steps'],
    },
    handler: async (input) => {
      const st = safeName(String(input.team || ''), 'team');
      if (!st.ok) return errResult(st.error);
      let stepsIn: unknown[] = [];
      if (Array.isArray(input.steps)) {
        stepsIn = input.steps;
      } else if (typeof input.steps === 'string') {
        try {
          stepsIn = JSON.parse(input.steps);
        } catch {
          stepsIn = String(input.steps).split(',').map((s) => s.trim()).filter(Boolean);
        }
      }

      return withTeamLock(st.value, () => {
        const { team, error } = loadTeam(st.value);
        if (error) return errResult(error);
        if (!team) return errResult(`Team "${st.value}" not found`);
        team.plan = {
          steps: stepsIn.map((s, i) => {
            const step = normalizeStep(s, i);
            // A new plan always starts fresh, whatever status the input carried.
            return { id: step.id, agent: step.agent, status: i === 0 ? 'ready' : 'pending' };
          }),
          index: 0,
          updatedAt: nowIso(),
        };
        saveTeam(team);
        return okResult({ action: 'plan', plan: team.plan });
      });
    },
  },
  {
    name: 'team_status',
    description: 'Team members, plan progress, and pending mailbox counts. Use when native Task is wrong because it has no cross-host visibility into a team\'s roster or pipeline state — reads the same .claude-flow/teams/ state that team_plan and team_send write.',
    category: 'team',
    inputSchema: {
      type: 'object',
      properties: {
        team: { type: 'string', description: 'Team id' },
      },
      required: ['team'],
    },
    handler: async (input) => {
      const st = safeName(String(input.team || ''), 'team');
      if (!st.ok) return errResult(st.error);
      const { team, error } = loadTeam(st.value);
      if (error) return errResult(error);
      if (!team) return errResult(`Team "${st.value}" not found`);

      // Include registered members and any mailbox dirs (pre-spawn handoffs).
      const mail: Record<string, number> = {};
      const names = new Set(Object.keys(team.members || {}));
      const root = mailboxRoot();
      if (existsSync(root)) {
        for (const ent of readdirSync(root, { withFileTypes: true })) {
          if (ent.isDirectory()) names.add(ent.name);
        }
      }
      for (const name of names) {
        mail[name] = listMailboxFiles(name).length;
      }
      return okResult({ action: 'status', team, pendingMail: mail });
    },
  },
  {
    name: 'team_on_stop',
    description:
      'Mark an agent stopped (done or failed), advance the team_plan pipeline on done, and return the next assignment hint. Use when native Task has no cross-host equivalent to SubagentStop-driven pipeline advancement; wire this from SubagentStop hooks or `ruflo team run` instead of polling team_status. A repeated runId is a no-op.',
    category: 'team',
    inputSchema: {
      type: 'object',
      properties: {
        team: { type: 'string', description: 'Team id' },
        agent: { type: 'string', description: 'Agent that stopped (a "role:agent" label is accepted)' },
        outcome: { type: 'string', description: 'done (default) or failed; failed does not advance the plan' },
        runId: { type: 'string', description: 'Run id; a repeat for the same agent is ignored' },
        reason: { type: 'string', description: 'Why the run failed (recorded on the member)' },
      },
      required: ['team', 'agent'],
    },
    handler: async (input) => {
      const st = safeName(String(input.team || ''), 'team');
      if (!st.ok) return errResult(st.error);
      const sa = safeName(normalizeAgentLabel(String(input.agent || '')), 'agent');
      if (!sa.ok) return errResult(sa.error);
      const outcome = input.outcome === undefined ? 'done' : String(input.outcome);
      if (outcome !== 'done' && outcome !== 'failed') return errResult('outcome must be "done" or "failed"');
      const runId = input.runId === undefined ? undefined : String(input.runId);
      if (runId !== undefined && !RUN_ID_RE.test(runId)) return errResult('Invalid runId');
      const reason = input.reason === undefined ? undefined : String(input.reason).slice(0, 4000);

      return withTeamLock(st.value, () => {
        const { team, error } = loadTeam(st.value);
        if (error) return errResult(error);
        if (!team) return errResult(`Team "${st.value}" not found`);

        const stop = applyStop(team, sa.value, outcome, runId, reason);
        if (stop.duplicate) return okResult({ action: 'on-stop', agent: sa.value, duplicate: true, runId });
        saveTeam(team);

        const plan = team.plan;
        if (outcome === 'failed') {
          return okResult({
            action: 'on-stop',
            agent: sa.value,
            outcome,
            next: stop.current ?? plan.steps[plan.index] ?? null,
            assign: {
              hint: `Agent "${sa.value}" failed${reason ? ` (${reason.slice(0, 200)})` : ''}: retry with \`ruflo team run\` or reassign the step`,
              agent: sa.value,
            },
          });
        }
        const nextStep = plan.steps[plan.index];
        return okResult({
          action: 'on-stop',
          agent: sa.value,
          outcome,
          next: nextStep || null,
          assign: nextStep
            ? {
                hint: `Spawn or resume agent "${nextStep.agent}" for the next plan step`,
                agent: nextStep.agent,
              }
            : { hint: 'Plan complete — lead should synthesize' },
        });
      });
    },
  },
  {
    name: 'team_shutdown',
    description: 'Graceful team teardown — marks team and members shutdown. Use when native Task is wrong because it has no host-agnostic team lifecycle to close out; call this instead of leaving mailbox/plan state orphaned after a multi-host run.',
    category: 'team',
    inputSchema: {
      type: 'object',
      properties: {
        team: { type: 'string', description: 'Team id' },
      },
      required: ['team'],
    },
    handler: async (input) => {
      const st = safeName(String(input.team || ''), 'team');
      if (!st.ok) return errResult(st.error);
      return withTeamLock(st.value, () => {
        const { team, error } = loadTeam(st.value);
        if (error) return errResult(error);
        if (!team) return errResult(`Team "${st.value}" not found`);
        team.status = 'shutdown';
        team.shutdownAt = nowIso();
        for (const m of Object.values(team.members || {})) {
          m.status = 'shutdown';
        }
        saveTeam(team);
        return okResult({ action: 'shutdown', teamId: team.id });
      });
    },
  },
];
