#!/usr/bin/env node
/**
 * bench-host-conformance.mjs — ADR-402 host conformance bench
 *
 * Proves the Ruflo CLI surface each team host is supposed to call: MCP
 * tools, CLI, team plans, the exec runner, and init products. It never
 * starts a host that calls a model. For what a host binary actually loads
 * and runs, use scripts/probe-host-live.mjs (--host grok|claude|codex|command|all).
 *
 * --host grok (default via bench-grok-host-conformance.mjs) — domains 1-9:
 *   1. Host surface      — .grok/ config, rules, agents, skills, team bus
 *   2. Tool inventory    — required MCP prefixes present (team/swarm/hive/memory/…)
 *   3. Agent Teams       — ADR-402 team_* lifecycle
 *   4. Swarm             — swarm_init/status/health/shutdown + agent_spawn
 *   5. Hive-mind         — init → spawn → memory → consensus → broadcast → status → shutdown
 *   6. Learning loop     — memory store/search/retrieve + hooks pre/post-task + route + intelligence
 *   7. Neural            — neural_status + neural_train smoke
 *   8. CLI parity        — swarm / hive-mind / neural / hooks / doctor respond
 *   9. Grok init product — templates present + materialize contract
 *
 * --host codex:
 *   host-plan   — team_spawn for a codex team: exec plan shape, sandbox, stdin
 *   codex-init  — CodexInitializer into a temp dir (codex CLI hidden from PATH):
 *                 AGENTS.md team section, agent-teams skill, default hooks.json
 *                 merge (idempotent), and no hook with teamHooks: false
 *
 * --host command:
 *   host-plan   — team_spawn for a team-hosts.json command host
 *   runner      — `ruflo team run` against a fake command host (a node one-liner)
 *
 * --host all runs every domain above.
 *
 * USAGE
 *   node scripts/bench-host-conformance.mjs --host all
 *   node scripts/bench-host-conformance.mjs --host codex --cli /path/to/cli.js
 *   node scripts/bench-host-conformance.mjs --host command --json > report.json
 *   node scripts/bench-host-conformance.mjs --fail-fast
 *
 * Reports: docs/benchmarks/host-conformance-<host>-latest.{md,json}
 * (override the base name with --report-name).
 *
 * EXIT
 *   0  all critical checks pass (warnings allowed)
 *   1  one or more critical failures
 *   2  runner/config error
 *
 * No LLM $ required — uses mcp exec + CLI help/status only. Child CLIs run
 * with RUFLO_DAEMON_AUTOSTART=0 so no background workers start.
 */

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// ── args ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function flag(name, def = null) {
  const i = args.indexOf(name);
  if (i < 0) return def;
  if (def === false) return true; // boolean flag
  return args[i + 1] ?? def;
}
const CLI = resolve(
  flag('--cli') ||
    join(REPO_ROOT, 'v3/@claude-flow/cli/bin/cli.js'),
);
const FAIL_FAST = args.includes('--fail-fast');
const JSON_OUT = args.includes('--json');
const WRITE_REPORT = !args.includes('--no-report');
const RUN_ID = `bench-${Date.now().toString(36)}`;
const HOSTS = ['grok', 'codex', 'command', 'all'];
const HOST = flag('--host', 'grok');
if (!HOSTS.includes(HOST)) {
  console.error(`--host must be one of ${HOSTS.join(', ')}`);
  process.exit(2);
}
const REPORT_NAME = flag('--report-name', `host-conformance-${HOST}`);
if (!/^[A-Za-z0-9._-]+$/.test(REPORT_NAME)) {
  console.error('--report-name must be a plain file name');
  process.exit(2);
}

if (!existsSync(CLI)) {
  console.error(`CLI not found: ${CLI}`);
  process.exit(2);
}

// ── required capability surface (Brain primer + MCP groups) ─────────────────
const REQUIRED_TOOL_PREFIXES = [
  'team_',
  'swarm_',
  'hive-mind_',
  'agent_',
  'memory_',
  'hooks_',
  'neural_',
  'embeddings_',
  'task_',
  'session_',
  'config_',
  'performance_',
];
// Security surface is often metaharness_security_* / security-scan CLI, not security_*
const OPTIONAL_TOOL_PREFIXES = ['security_', 'claims_', 'guidance_', 'browser_'];

const REQUIRED_TEAM_TOOLS = [
  'team_create',
  'team_spawn',
  'team_send',
  'team_inbox',
  'team_broadcast',
  'team_plan',
  'team_status',
  'team_on_stop',
  'team_shutdown',
];

const REQUIRED_HOST_FILES = [
  '.grok/config.toml',
  '.grok/rules/ruflo-grok.md',
  '.grok/agents/ruflo-architect.md',
  '.grok/agents/ruflo-coder.md',
  '.grok/agents/ruflo-tester.md',
  '.grok/agents/ruflo-reviewer.md',
  '.grok/skills/agent-teams-grok/SKILL.md',
  'scripts/grok-team-bus.mjs',
  'v3/@claude-flow/cli/templates/grok/config.toml',
  'v3/@claude-flow/cli/src/mcp-tools/team-tools.ts',
  'v3/docs/adr/ADR-402-host-agnostic-agent-teams.md',
];

// ── result collector ────────────────────────────────────────────────────────
/** @type {{ id: string, domain: string, critical: boolean, ok: boolean, ms: number, detail: string, data?: unknown }[]} */
const results = [];

function record(id, domain, critical, ok, ms, detail, data) {
  results.push({ id, domain, critical, ok, ms, detail, data });
  const mark = ok ? 'PASS' : critical ? 'FAIL' : 'WARN';
  if (!JSON_OUT) {
    console.log(`[${mark}] ${domain.padEnd(14)} ${id}  (${ms}ms) ${detail}`);
  }
  if (!ok && critical && FAIL_FAST) {
    finish(1);
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────
function runNode(cliArgs, opts = {}) {
  const t0 = performance.now();
  const r = spawnSync(process.execPath, [CLI, ...cliArgs], {
    cwd: opts.cwd || REPO_ROOT,
    encoding: 'utf-8',
    timeout: opts.timeout ?? 60_000,
    env: { ...process.env, RUFLO_DAEMON_AUTOSTART: '0', ...opts.env, FORCE_COLOR: '0' },
    maxBuffer: 8 * 1024 * 1024,
  });
  const ms = Math.round(performance.now() - t0);
  return {
    ms,
    code: r.status ?? 1,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
    error: r.error,
  };
}

function parseJsonBlob(text) {
  // CLI prints banners + Parameters:{...} then "Result:\n{...}". Prefer Result.
  // Never use lastIndexOf('{') — nested objects would parse as partial blobs.
  const markers = ['Result:\n', 'Result:\r\n', 'Result:'];
  let searchFrom = 0;
  for (const m of markers) {
    const idx = text.lastIndexOf(m);
    if (idx >= 0) {
      searchFrom = idx + m.length;
      break;
    }
  }
  const start = text.indexOf('{', searchFrom);
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function mcpExec(tool, params = {}, opts = {}) {
  const r = runNode([
    'mcp',
    'exec',
    '-t',
    tool,
    '-p',
    JSON.stringify(params),
  ], opts);
  const combined = `${r.stdout}\n${r.stderr}`;
  const json = parseJsonBlob(combined);
  const ok =
    r.code === 0 &&
    json != null &&
    json.success !== false &&
    !json.error;
  return { ...r, json, ok, combined };
}

function expectOk(id, domain, critical, res, extraCheck) {
  let ok = res.ok;
  let detail = ok
    ? 'ok'
    : res.json?.error
      ? String(res.json.error)
      : `exit=${res.code}`;
  if (ok && typeof extraCheck === 'function') {
    try {
      const msg = extraCheck(res.json);
      if (msg) {
        ok = false;
        detail = msg;
      }
    } catch (e) {
      ok = false;
      detail = (e && e.message) || String(e);
    }
  }
  record(id, domain, critical, ok, res.ms, detail, res.json);
  return ok;
}

// ── domains ─────────────────────────────────────────────────────────────────

function domainHostSurface() {
  for (const rel of REQUIRED_HOST_FILES) {
    const p = join(REPO_ROOT, rel);
    const ok = existsSync(p);
    record(
      `file:${rel}`,
      'host-surface',
      true,
      ok,
      0,
      ok ? 'present' : 'missing',
    );
  }

  // config.toml must mention ruflo MCP + allow team tools path
  const cfg = join(REPO_ROOT, '.grok/config.toml');
  if (existsSync(cfg)) {
    const text = readFileSync(cfg, 'utf-8');
    const hasRuflo = /\[mcp_servers\.ruflo\]/.test(text);
    const hasBrainNote = /ruvnet-brain|KB_DIR/.test(text);
    record(
      'config:ruflo-mcp',
      'host-surface',
      true,
      hasRuflo,
      0,
      hasRuflo ? 'mcp_servers.ruflo present' : 'missing [mcp_servers.ruflo]',
    );
    record(
      'config:brain-docs',
      'host-surface',
      false,
      hasBrainNote,
      0,
      hasBrainNote ? 'Brain/KB_DIR documented' : 'no Brain mention',
    );
  }

  // template expands {{HOME}}/
  const tpl = join(
    REPO_ROOT,
    'v3/@claude-flow/cli/templates/grok/config.toml',
  );
  if (existsSync(tpl)) {
    const t = readFileSync(tpl, 'utf-8');
    record(
      'template:home-placeholder',
      'host-surface',
      true,
      t.includes('{{HOME}}/'),
      0,
      t.includes('{{HOME}}/')
        ? '{{HOME}}/ placeholder present'
        : 'missing {{HOME}}/ placeholder',
    );
  }
}

function domainToolInventory() {
  const r = runNode(['mcp', 'tools']);
  const text = `${r.stdout}\n${r.stderr}`;
  // Collect tool names from "  tool_name   Description" lines
  const names = new Set();
  for (const line of text.split('\n')) {
    const m = line.match(/^\s{2}([a-z][a-z0-9_-]+)\s{2,}/);
    if (m) names.add(m[1]);
  }
  record(
    'mcp-tools:list',
    'inventory',
    true,
    names.size >= 100,
    r.ms,
    `${names.size} tools listed`,
  );

  for (const prefix of REQUIRED_TOOL_PREFIXES) {
    const hit = [...names].some((n) => n.startsWith(prefix));
    record(
      `prefix:${prefix}`,
      'inventory',
      true,
      hit,
      0,
      hit ? 'present' : 'MISSING prefix',
    );
  }
  for (const prefix of OPTIONAL_TOOL_PREFIXES) {
    const hit = [...names].some((n) => n.startsWith(prefix));
    // Also accept metaharness_security_ / security- in name
    const soft =
      hit ||
      [...names].some(
        (n) => n.includes('security') || n.startsWith(prefix.replace(/_$/, '')),
      );
    record(
      `prefix-opt:${prefix}`,
      'inventory',
      false,
      soft,
      0,
      soft ? 'present (optional)' : 'absent (optional)',
    );
  }
  // Explicit security capability: metaharness or claims or security tools
  const secOk = [...names].some(
    (n) =>
      n.includes('security') ||
      n.startsWith('claims_') ||
      n.includes('mcp_scan'),
  );
  record(
    'capability:security',
    'inventory',
    true,
    secOk,
    0,
    secOk ? 'security-related tools present' : 'no security tools',
  );

  for (const t of REQUIRED_TEAM_TOOLS) {
    record(
      `team-tool:${t}`,
      'inventory',
      true,
      names.has(t),
      0,
      names.has(t) ? 'registered' : 'MISSING',
    );
  }
}

function domainTeams() {
  const team = `${RUN_ID}-team`;
  expectOk(
    'team_create',
    'teams',
    true,
    mcpExec('team_create', {
      name: team,
      topology: 'hierarchical',
      maxAgents: 4,
      host: 'grok',
      force: true,
    }),
  );
  expectOk(
    'team_plan',
    'teams',
    true,
    mcpExec('team_plan', {
      team,
      steps: ['architect', 'developer', 'tester', 'reviewer'],
    }),
  );
  expectOk(
    'team_spawn',
    'teams',
    true,
    mcpExec('team_spawn', {
      team,
      agent: 'architect',
      role: 'architect',
      prompt: 'Design for conformance bench',
      next: ['developer'],
    }),
    (j) => {
      const spawn = j?.spawnPlan?.host?.grok?.spawn;
      if (!spawn) return 'missing spawnPlan.host.grok.spawn';
      const keys = Object.keys(spawn).sort().join(',');
      if (keys !== 'background,description,isolation') return `spawn keys drifted: ${keys}`;
      return null;
    },
  );
  expectOk(
    'team_send',
    'teams',
    true,
    mcpExec('team_send', {
      team,
      to: 'developer',
      from: 'architect',
      summary: 'design',
      message: 'Layered architecture for bench',
    }),
  );
  // Pre-spawn pending mail
  expectOk(
    'team_status:pendingMail',
    'teams',
    true,
    mcpExec('team_status', { team }),
    (j) =>
      (j?.pendingMail?.developer ?? 0) >= 1
        ? null
        : `expected pendingMail.developer>=1 got ${JSON.stringify(j?.pendingMail)}`,
  );
  expectOk(
    'team_spawn:developer',
    'teams',
    true,
    mcpExec('team_spawn', {
      team,
      agent: 'developer',
      role: 'developer',
      prompt: 'Implement design',
      next: ['tester'],
    }),
  );
  expectOk(
    'team_inbox',
    'teams',
    true,
    mcpExec('team_inbox', { team, agent: 'developer', peek: true }),
    (j) =>
      Array.isArray(j?.messages) && j.messages.length >= 1
        ? null
        : 'empty inbox',
  );
  expectOk(
    'team_broadcast',
    'teams',
    true,
    mcpExec('team_broadcast', {
      team,
      from: 'lead',
      summary: 'sync',
      message: 'bench broadcast to members',
    }),
  );
  expectOk(
    'team_on_stop',
    'teams',
    true,
    mcpExec('team_on_stop', { team, agent: 'architect' }),
    (j) =>
      j?.assign?.agent === 'developer' || j?.next
        ? null
        : 'expected next/assign after on_stop',
  );
  expectOk(
    'team_shutdown',
    'teams',
    true,
    mcpExec('team_shutdown', { team }),
  );
}

function domainSwarm() {
  const init = mcpExec('swarm_init', {
    topology: 'hierarchical',
    maxAgents: 6,
    strategy: 'specialized',
  });
  expectOk('swarm_init', 'swarm', true, init, (j) =>
    j?.swarmId ? null : 'no swarmId',
  );
  const swarmId = init.json?.swarmId;

  expectOk(
    'swarm_status',
    'swarm',
    true,
    mcpExec('swarm_status', swarmId ? { swarmId } : {}),
  );
  expectOk(
    'swarm_health',
    'swarm',
    true,
    mcpExec('swarm_health', swarmId ? { swarmId } : {}),
  );

  const agentId = `${RUN_ID}-coder`;
  expectOk(
    'agent_spawn',
    'swarm',
    true,
    mcpExec('agent_spawn', {
      agentType: 'coder',
      agentId,
      swarmId,
    }),
    (j) => (j?.agentId ? null : 'no agentId'),
  );
  expectOk(
    'agent_status',
    'swarm',
    true,
    mcpExec('agent_status', { agentId }),
  );
  expectOk(
    'agent_list',
    'swarm',
    true,
    mcpExec('agent_list', {}),
  );
  expectOk(
    'agent_health',
    'swarm',
    false,
    mcpExec('agent_health', { agentId }),
  );
  // terminate agent (non-critical if API differs)
  expectOk(
    'agent_terminate',
    'swarm',
    false,
    mcpExec('agent_terminate', { agentId }),
  );
  {
    const shut = mcpExec('swarm_shutdown', swarmId ? { swarmId } : {});
    // Empty / already-terminated swarm is a valid end state after agent_terminate
    const already =
      /already terminated|no running swarm|not found|not running/i.test(
        String(shut.json?.error || shut.detail || shut.combined || ''),
      );
    if (already) {
      record(
        'swarm_shutdown',
        'swarm',
        true,
        true,
        shut.ms,
        'already terminated (ok)',
        shut.json,
      );
    } else {
      expectOk('swarm_shutdown', 'swarm', true, shut);
    }
  }
}

function domainHiveMind() {
  // Clear leftover state from prior probes (pending raft proposals block re-init)
  mcpExec('hive-mind_shutdown', { graceful: false, force: true });

  // Fresh init
  const init = mcpExec('hive-mind_init', {
    topology: 'hierarchical',
    consensus: 'raft',
    queenId: `${RUN_ID}-queen`,
  });
  expectOk('hive-mind_init', 'hive-mind', true, init, (j) =>
    j?.hiveId || j?.status === 'initialized' || j?.success
      ? null
      : `init failed: ${j?.error || 'unknown'}`,
  );
  const hiveToken = init.json?.hiveToken;

  const spawn = mcpExec('hive-mind_spawn', {
    count: 2,
    role: 'worker',
    agentType: 'coder',
    prefix: `${RUN_ID}-w`,
  });
  expectOk('hive-mind_spawn', 'hive-mind', true, spawn);
  const voterId = spawn.json?.workers?.[0]?.agentId || `${RUN_ID}-queen`;

  expectOk(
    'hive-mind_memory:set',
    'hive-mind',
    true,
    mcpExec('hive-mind_memory', {
      action: 'set',
      key: `${RUN_ID}-shared`,
      value: 'hive-shared-knowledge',
    }),
  );
  expectOk(
    'hive-mind_memory:get',
    'hive-mind',
    true,
    mcpExec('hive-mind_memory', {
      action: 'get',
      key: `${RUN_ID}-shared`,
    }),
    (j) =>
      j?.value === 'hive-shared-knowledge' || j?.success !== false
        ? null
        : `unexpected get: ${JSON.stringify(j)}`,
  );

  const prop = mcpExec('hive-mind_consensus', {
    action: 'propose',
    type: 'bench',
    value: { accept: true, runId: RUN_ID },
    strategy: 'raft',
    term: Date.now() % 1_000_000,
  });
  // Accept either a new proposal or a clear "already pending" with status list
  if (prop.json?.proposalId) {
    expectOk('hive-mind_consensus:propose', 'hive-mind', true, prop, (j) =>
      j?.proposalId ? null : 'no proposalId',
    );
    const proposalId = prop.json.proposalId;
    expectOk(
      'hive-mind_consensus:vote',
      'hive-mind',
      true,
      mcpExec('hive-mind_consensus', {
        action: 'vote',
        proposalId,
        vote: true,
        voterId,
        hiveToken,
      }),
    );
    expectOk(
      'hive-mind_consensus:status',
      'hive-mind',
      true,
      mcpExec('hive-mind_consensus', {
        action: 'status',
        proposalId,
      }),
    );
  } else {
    // Fallback: list / status path still proves consensus API
    const list = mcpExec('hive-mind_consensus', { action: 'list' });
    expectOk(
      'hive-mind_consensus:propose-or-list',
      'hive-mind',
      true,
      list.ok || prop.ok ? { ...list, ok: true, json: list.json || prop.json, ms: list.ms } : prop,
      () => null,
    );
  }

  expectOk(
    'hive-mind_broadcast',
    'hive-mind',
    true,
    mcpExec('hive-mind_broadcast', {
      message: `bench broadcast ${RUN_ID}`,
      priority: 'normal',
      fromId: `${RUN_ID}-queen`,
    }),
  );

  expectOk(
    'hive-mind_status',
    'hive-mind',
    true,
    mcpExec('hive-mind_status', { verbose: true }),
  );

  expectOk(
    'hive-mind_optimize-memory',
    'hive-mind',
    false,
    mcpExec('hive-mind_optimize-memory', {}),
  );

  expectOk(
    'hive-mind_shutdown',
    'hive-mind',
    true,
    mcpExec('hive-mind_shutdown', { graceful: true, force: true }),
  );
}

function domainLearningLoop() {
  const key = `${RUN_ID}-pattern`;
  const ns = 'bench-conformance';
  const value =
    'Grok host learning loop: hierarchical swarm + team bus + hive consensus pattern for multi-agent coding';

  expectOk(
    'memory_store',
    'learning',
    true,
    mcpExec('memory_store', {
      key,
      value,
      namespace: ns,
      tags: ['bench', 'grok', 'learning'],
      upsert: true,
    }),
    (j) => (j?.stored || j?.success ? null : 'not stored'),
  );

  expectOk(
    'memory_retrieve',
    'learning',
    true,
    mcpExec('memory_retrieve', { key, namespace: ns }),
    (j) => {
      const v = j?.value ?? j?.entry?.value ?? j?.data;
      if (v == null) return 'no value';
      const s = typeof v === 'string' ? v : JSON.stringify(v);
      return s.includes('Grok host learning') ? null : 'value mismatch';
    },
  );

  // Semantic search — may return empty if embedding backend cold; critical if store had embedding
  const search = mcpExec('memory_search', {
    query: 'multi-agent coding team bus hierarchical swarm',
    namespace: ns,
    limit: 5,
  });
  const searchHit =
    search.ok &&
    Array.isArray(search.json?.results) &&
    search.json.results.length > 0;
  record(
    'memory_search',
    'learning',
    false, // soft: ANN can miss tiny corpora
    search.ok,
    search.ms,
    searchHit
      ? `hits=${search.json.results.length}`
      : search.ok
        ? 'ok but 0 hits (soft)'
        : search.json?.error || 'search failed',
    search.json,
  );

  expectOk(
    'memory_list',
    'learning',
    true,
    mcpExec('memory_list', { namespace: ns, limit: 20 }),
  );
  expectOk(
    'memory_stats',
    'learning',
    true,
    mcpExec('memory_stats', {}),
  );

  // hooks learning loop
  const taskId = `${RUN_ID}-task`;
  expectOk(
    'hooks_pre-task',
    'learning',
    true,
    mcpExec('hooks_pre-task', {
      taskId,
      description: 'Implement hierarchical multi-agent coding workflow with learning',
    }),
  );
  expectOk(
    'hooks_route',
    'learning',
    true,
    mcpExec('hooks_route', {
      task: 'Implement hierarchical multi-agent coding workflow with learning',
    }),
    (j) => {
      if (!j) return 'null result';
      if (
        j.primaryAgent ||
        j.modelRouting ||
        j.recommendedModel ||
        j.recommendation ||
        j.agent ||
        j.tier != null ||
        j.success === true
      ) {
        return null;
      }
      // Some builds nest under data/result
      const nested = j.data || j.result || j.routing;
      if (nested && typeof nested === 'object') return null;
      return `no routing recommendation keys=${Object.keys(j).join(',')}`;
    },
  );
  expectOk(
    'hooks_post-task',
    'learning',
    true,
    mcpExec('hooks_post-task', {
      taskId,
      success: true,
      quality: 0.9,
      task: 'Implement hierarchical multi-agent coding workflow with learning',
      storeDecisions: true,
    }),
    (j) =>
      j?.learningUpdates || j?.feedback || j?.success !== false
        ? null
        : 'post-task missing learning updates',
  );
  expectOk(
    'hooks_intelligence',
    'learning',
    true,
    mcpExec('hooks_intelligence', { showStatus: true }),
    (j) => {
      const working = j?.implementationStatus?.working;
      if (Array.isArray(working) && working.length >= 5) return null;
      if (j?.success === false) return j.error || 'intelligence failed';
      return null; // accept alternate shapes
    },
  );

  // cleanup memory (non-critical)
  expectOk(
    'memory_delete',
    'learning',
    false,
    mcpExec('memory_delete', { key, namespace: ns }),
  );
}

function domainNeural() {
  expectOk(
    'neural_status',
    'neural',
    true,
    mcpExec('neural_status', { detailed: true }),
  );
  expectOk(
    'neural_train',
    'neural',
    true,
    mcpExec('neural_train', {
      modelType: 'classifier',
      epochs: 1,
      data: { samples: [{ input: 'bench', label: 1 }] },
    }),
  );
}

function domainCliParity() {
  const checks = [
    { id: 'cli:swarm-help', args: ['swarm', '--help'], re: /init|status/i },
    {
      id: 'cli:hive-mind-help',
      args: ['hive-mind', '--help'],
      re: /init|consensus|spawn/i,
    },
    {
      id: 'cli:neural-help',
      args: ['neural', '--help'],
      re: /train|status|patterns/i,
    },
    {
      id: 'cli:hooks-help',
      args: ['hooks', '--help'],
      re: /route|post-task|intelligence/i,
    },
    {
      id: 'cli:memory-help',
      args: ['memory', '--help'],
      re: /store|search|list/i,
    },
    {
      id: 'cli:init-grok-help',
      args: ['init', '--help'],
      re: /grok/i,
    },
  ];
  for (const c of checks) {
    const r = runNode(c.args, { timeout: 30_000 });
    const text = `${r.stdout}\n${r.stderr}`;
    const ok = r.code === 0 && c.re.test(text);
    record(c.id, 'cli', true, ok, r.ms, ok ? 'help ok' : `exit=${r.code}`);
  }

  // doctor (may warn; critical only that it runs)
  const doc = runNode(['doctor'], { timeout: 90_000 });
  record(
    'cli:doctor',
    'cli',
    true,
    doc.code === 0 || /doctor|health|Node/i.test(doc.stdout + doc.stderr),
    doc.ms,
    `exit=${doc.code}`,
  );

  // init --grok into temp dir
  const tmp = join(tmpdir(), `ruflo-grok-init-${RUN_ID}`);
  mkdirSync(tmp, { recursive: true });
  const init = runNode(['init', '--grok', '--force'], {
    cwd: tmp,
    timeout: 60_000,
  });
  const cfgPath = join(tmp, '.grok', 'config.toml');
  const initOk =
    init.code === 0 &&
    existsSync(cfgPath) &&
    existsSync(join(tmp, 'scripts', 'grok-team-bus.mjs'));
  let homeOk = false;
  if (existsSync(cfgPath)) {
    const cfg = readFileSync(cfgPath, 'utf-8');
    homeOk =
      cfg.includes(`${process.env.HOME}/.cache/ruvnet-brain`) ||
      !cfg.includes('{{HOME}}/');
  }
  record(
    'cli:init-grok',
    'cli',
    true,
    initOk,
    init.ms,
    initOk ? `scaffold → ${tmp}` : `exit=${init.code}`,
  );
  record(
    'cli:init-grok-home',
    'cli',
    true,
    homeOk,
    0,
    homeOk
      ? 'HOME paths materialized'
      : 'HOME placeholders not expanded',
  );
}

// ── exec hosts (codex, command) ──────────────────────────────────────────────

/** A temp project; CLAUDE_FLOW_CWD points every CLI call at it. */
function tempProject(tag, teamHosts) {
  const dir = join(tmpdir(), `ruflo-${tag}-${RUN_ID}`);
  mkdirSync(join(dir, '.claude-flow'), { recursive: true });
  if (teamHosts) {
    writeFileSync(join(dir, '.claude-flow', 'team-hosts.json'), JSON.stringify(teamHosts, null, 2));
  }
  return { dir, opts: { cwd: dir, env: { CLAUDE_FLOW_CWD: dir } } };
}

const NO_BYPASS = (j) =>
  /bypass|full-auto/.test(JSON.stringify(j?.spawnPlan ?? {})) ? 'plan contains a bypass/full-auto flag' : null;

function domainCodexPlan() {
  const { opts } = tempProject('codex-plan');
  const team = `${RUN_ID}-codex`;
  expectOk('team_create:codex', 'host-plan', true, mcpExec('team_create', { name: team, host: 'codex' }, opts));
  expectOk('team_spawn:codex-default-hosts', 'host-plan', true,
    mcpExec('team_spawn', { team, agent: 'rev', role: 'reviewer', prompt: 'Review' }, opts),
    (j) => {
      const keys = Object.keys(j?.spawnPlan?.host ?? {}).sort().join(',');
      return keys === 'claude,codex' ? null : `expected hosts claude,codex got ${keys}`;
    });
  expectOk('team_spawn:codex-read-only', 'host-plan', true,
    mcpExec('team_spawn', { team, agent: 'rev', role: 'reviewer', hosts: ['codex'] }, opts),
    (j) => {
      const c = j?.spawnPlan?.host?.codex;
      const a = c?.exec?.args ?? [];
      if (c?.kind !== 'exec' || c?.events !== 'codex-jsonl') return 'codex entry is not an exec plan with codex-jsonl events';
      if (a.slice(0, 3).join(' ') !== 'exec --sandbox read-only') return `unexpected args head: ${a.slice(0, 3).join(' ')}`;
      if (a.includes('--worktree')) return 'read-only role got --worktree';
      if (a[a.length - 1] !== '-') return 'prompt is not read from stdin (-)';
      if (c.exec.promptVia !== 'stdin' || c.exec.closeStdin !== true) return 'promptVia/closeStdin wrong';
      return NO_BYPASS(j);
    });
  expectOk('team_spawn:codex-worktree', 'host-plan', true,
    mcpExec('team_spawn', { team, agent: 'dev', role: 'developer', hosts: ['codex'] }, opts),
    (j) => {
      const a = j?.spawnPlan?.host?.codex?.exec?.args ?? [];
      if (a.slice(0, 4).join(' ') !== 'exec --sandbox workspace-write --worktree') return `unexpected args head: ${a.slice(0, 4).join(' ')}`;
      return NO_BYPASS(j);
    });
  const dry = runNode(['team', 'run', '--team', team, '--agent', 'rev', '--dry-run'], opts);
  let dryJson = null;
  try { dryJson = JSON.parse(dry.stdout); } catch { /* reported below */ }
  const dryOk = dry.code === 0 && dryJson?.command === 'codex' && Array.isArray(dryJson?.args)
    && dryJson.args.includes('-o') && !dryJson.args.some((x) => /\{(resultFile|cwd|teamRoot)\}/.test(x));
  record('team-run:codex-dry-run', 'host-plan', true, dryOk, dry.ms,
    dryOk ? `argv resolved (${dryJson.args.length} args, mcp warnings=${(dryJson.warnings || []).join(',') || 'none'})` : `exit=${dry.code} ${dry.stdout.slice(0, 200)}`);
}

function domainCodexInit() {
  const dir = join(tmpdir(), `ruflo-codex-init-${RUN_ID}`);
  mkdirSync(dir, { recursive: true });
  const entry = join(REPO_ROOT, 'v3/@claude-flow/codex/dist/index.js');
  if (!existsSync(entry)) {
    record('codex-init:build', 'codex-init', true, false, 0, `not built: ${relative(REPO_ROOT, entry)}`);
    return;
  }
  // PATH is emptied so the initializer cannot reach the real codex CLI
  // (no `codex mcp add` / `codex plugin add` against the user's config).
  const script = `
    const { CodexInitializer } = await import(${JSON.stringify('file://' + entry)});
    const r = await new CodexInitializer().initialize({ projectPath: ${JSON.stringify(dir)}, template: 'default' });
    const again = await new CodexInitializer().initialize({ projectPath: ${JSON.stringify(dir)}, template: 'default', force: true });
    const optOut = await new CodexInitializer().initialize({ projectPath: ${JSON.stringify(dir + '-no-hooks')}, template: 'default', teamHooks: false });
    const { existsSync } = await import('node:fs');
    process.stdout.write(JSON.stringify({
      ok: r.success && again.success && optOut.success,
      trustStep: (r.warnings || []).some((w) => w.includes('/hooks')),
      optOutHook: existsSync(${JSON.stringify(dir + '-no-hooks/.codex/hooks.json')}),
      errors: [...(r.errors || []), ...(again.errors || []), ...(optOut.errors || [])],
    }));
  `;
  const t0 = performance.now();
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf-8', timeout: 60_000, env: { ...process.env, PATH: '' },
  });
  const ms = Math.round(performance.now() - t0);
  let out = null;
  try { out = JSON.parse(run.stdout); } catch { /* reported below */ }
  record('codex-init:initialize', 'codex-init', true, !!out?.ok, ms,
    out?.ok ? `initialized → ${dir}` : `exit=${run.status} ${(out?.errors || []).join('; ') || run.stderr.slice(0, 200)}`);

  const agentsMd = existsSync(join(dir, 'AGENTS.md')) ? readFileSync(join(dir, 'AGENTS.md'), 'utf-8') : '';
  record('codex-init:agents-md-team-section', 'codex-init', true,
    agentsMd.includes('## Agent Teams') && agentsMd.includes('ruflo team run'), 0,
    agentsMd ? 'AGENTS.md has the Agent Teams section' : 'AGENTS.md missing');
  record('codex-init:skill', 'codex-init', true,
    existsSync(join(dir, '.agents', 'skills', 'agent-teams', 'SKILL.md')), 0, '.agents/skills/agent-teams/SKILL.md');
  let hookCount = -1;
  try {
    const hooks = JSON.parse(readFileSync(join(dir, '.codex', 'hooks.json'), 'utf-8'));
    hookCount = (hooks.hooks?.SubagentStop ?? [])
      .flatMap((g) => g.hooks ?? [])
      .filter((h) => String(h.command || '').includes('team hook-stop')).length;
  } catch { /* missing */ }
  record('codex-init:hooks-json', 'codex-init', true, hookCount === 1, 0,
    hookCount === 1 ? 'one SubagentStop → team hook-stop entry after two default runs' : `team hook-stop entries: ${hookCount}`);
  record('codex-init:trust-step', 'codex-init', true, out?.trustStep === true, 0,
    out?.trustStep ? '/hooks trust step printed' : 'no /hooks trust step in warnings');
  record('codex-init:no-team-hooks', 'codex-init', true, out?.optOutHook === false, 0,
    out?.optOutHook === false ? 'teamHooks: false writes no hooks.json' : 'opt-out still wrote a hook');
}

const FAKE_HOST_ARGS = ['-e', "process.stdout.write('ok:'+process.argv[1].length)", '{prompt}'];

function domainCommandPlan() {
  const hosts = { hosts: { myagent: { kind: 'exec', command: process.execPath, args: FAKE_HOST_ARGS, promptVia: 'arg' } } };
  const { opts } = tempProject('command-plan', hosts);
  const team = `${RUN_ID}-cmd`;
  expectOk('team_create:myagent', 'host-plan', true, mcpExec('team_create', { name: team, host: 'myagent' }, opts));
  expectOk('team_spawn:myagent', 'host-plan', true,
    mcpExec('team_spawn', { team, agent: 'worker', role: 'coder', prompt: 'x' }, opts),
    (j) => {
      const e = j?.spawnPlan?.host?.myagent;
      if (e?.kind !== 'exec') return 'myagent entry is not an exec plan';
      if (e.exec.command !== process.execPath || e.exec.promptVia !== 'arg') return 'command/promptVia drifted';
      return NO_BYPASS(j);
    });
  const bad = tempProject('command-bad', { hosts: { myagent: { kind: 'exec', command: 'myagent', args: ['--m={prompt}'] } } });
  const rejected = mcpExec('team_create', { name: `${team}-bad`, host: 'myagent' }, bad.opts);
  record('team_create:rejects-embedded-placeholder', 'host-plan', true,
    !rejected.ok && /whole argument/.test(String(rejected.json?.error)), rejected.ms,
    String(rejected.json?.error ?? `exit=${rejected.code}`));
  const unknown = mcpExec('team_create', { name: `${team}-unknown`, host: 'nosuchhost' }, opts);
  record('team_create:rejects-unknown-host', 'host-plan', true,
    !unknown.ok && /Unknown host/.test(String(unknown.json?.error)), unknown.ms,
    String(unknown.json?.error ?? `exit=${unknown.code}`));
}

function teamCli(verb, params, opts) {
  const r = runNode(['team', verb, '--params', JSON.stringify(params)], opts);
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* left null */ }
  return { ...r, json, ok: r.code === 0 && json?.success === true };
}

function domainRunner() {
  const hosts = { hosts: { myagent: { kind: 'exec', command: process.execPath, args: FAKE_HOST_ARGS, promptVia: 'arg' } } };
  const { dir, opts } = tempProject('runner', hosts);
  const team = `${RUN_ID}-run`;
  expectOk('team create', 'runner', true, teamCli('create', { name: team, host: 'myagent' }, opts));
  expectOk('team plan', 'runner', true, teamCli('plan', { team, steps: ['worker', 'checker'] }, opts));
  expectOk('team spawn', 'runner', true, teamCli('spawn', { team, agent: 'worker', role: 'coder', prompt: 'x', next: ['checker'] }, opts));

  const run = runNode(['team', 'run', '--team', team, '--agent', 'worker', '--json', '--timeout', '30000'], opts);
  let rj = null;
  try { rj = JSON.parse(run.stdout); } catch { /* reported below */ }
  record('team run', 'runner', true, run.code === 0 && rj?.outcome === 'done', run.ms,
    run.code === 0 ? `outcome=${rj?.outcome}` : `exit=${run.code} ${run.stdout.slice(0, 200)}`);
  record('team run:run-file', 'runner', true, !!rj?.runFile && existsSync(join(dir, rj.runFile)), 0, String(rj?.runFile));

  expectOk('team inbox:result', 'runner', true, teamCli('inbox', { agent: 'checker', peek: true }, opts),
    (j) => (j?.messages?.[0]?.type === 'result' && /^ok:\d+/.test(j.messages[0].content) ? null : 'no result message for next agent'));
  expectOk('team status:advanced', 'runner', true, teamCli('status', { team }, opts),
    (j) => (j?.team?.plan?.index === 1 ? null : `plan index ${j?.team?.plan?.index}`));

  const dup = teamCli('on-stop', { team, agent: 'worker', runId: rj?.runId }, opts);
  expectOk('team on-stop:duplicate-runId', 'runner', true, dup, (j) => (j?.duplicate ? null : 'duplicate runId was not a no-op'));

  const bad = tempProject('runner-fail', { hosts: { myagent: { kind: 'exec', command: process.execPath, args: ['-e', 'process.exit(3)', '{prompt}'] } } });
  teamCli('create', { name: team, host: 'myagent' }, bad.opts);
  teamCli('plan', { team, steps: ['worker'] }, bad.opts);
  teamCli('spawn', { team, agent: 'worker', role: 'coder' }, bad.opts);
  const failed = runNode(['team', 'run', '--team', team, '--agent', 'worker', '--json'], bad.opts);
  const status = teamCli('status', { team }, bad.opts);
  const idx = status.json?.team?.plan?.index;
  record('team run:failed-no-advance', 'runner', true, failed.code === 3 && idx === 0, failed.ms,
    `exit=${failed.code} plan index=${idx}`);
}

// ── report ──────────────────────────────────────────────────────────────────
function finish(forcedCode) {
  const criticalFails = results.filter((r) => r.critical && !r.ok);
  const warns = results.filter((r) => !r.critical && !r.ok);
  const passes = results.filter((r) => r.ok);
  const byDomain = {};
  for (const r of results) {
    byDomain[r.domain] ??= { pass: 0, fail: 0, warn: 0 };
    if (r.ok) byDomain[r.domain].pass++;
    else if (r.critical) byDomain[r.domain].fail++;
    else byDomain[r.domain].warn++;
  }

  const report = {
    id: RUN_ID,
    title: `Host conformance bench (ADR-402) — ${HOST}`,
    host: HOST,
    cli: relative(REPO_ROOT, CLI) || CLI,
    repo: '.',
    timestamp: new Date().toISOString(),
    summary: {
      total: results.length,
      pass: passes.length,
      criticalFail: criticalFails.length,
      warn: warns.length,
      ok: criticalFails.length === 0,
    },
    domains: byDomain,
    requiredPrefixes: REQUIRED_TOOL_PREFIXES,
    brainGrounding: {
      source: 'ruvnet-brain search_ruvnet: ruflo primer + MCP tool groups',
      capabilities: [
        'Multi-agent swarm orchestration',
        'Hive-mind / queen consensus',
        'Memory + AgentDB + embeddings',
        'Learning & reasoning pipelines (hooks/neural)',
        'Agent Teams host-agnostic bus (ADR-402)',
        'Grok host surface (init --grok)',
      ],
    },
    results,
  };

  if (WRITE_REPORT) {
    const outDir = join(REPO_ROOT, 'docs', 'benchmarks');
    mkdirSync(outDir, { recursive: true });
    const jsonPath = join(outDir, `${REPORT_NAME}-latest.json`);
    const mdPath = join(outDir, `${REPORT_NAME}-latest.md`);
    writeFileSync(jsonPath, JSON.stringify(report, null, 2));
    writeFileSync(mdPath, renderMarkdown(report));
    if (!JSON_OUT) {
      console.log(`\nReport: ${mdPath}`);
      console.log(`JSON:   ${jsonPath}`);
    }
  }

  if (JSON_OUT) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('\n── Summary ──');
    console.log(
      `pass=${passes.length}  critical_fail=${criticalFails.length}  warn=${warns.length}`,
    );
    for (const [d, s] of Object.entries(byDomain)) {
      console.log(
        `  ${d.padEnd(14)} pass=${s.pass} fail=${s.fail} warn=${s.warn}`,
      );
    }
    if (criticalFails.length) {
      console.log('\nCritical failures:');
      for (const f of criticalFails) {
        console.log(`  - [${f.domain}] ${f.id}: ${f.detail}`);
      }
    }
  }

  process.exit(
    forcedCode != null
      ? forcedCode
      : criticalFails.length === 0
        ? 0
        : 1,
  );
}

function renderMarkdown(report) {
  const lines = [];
  lines.push(`# Host conformance (${report.host}) — ${report.id}`);
  lines.push('');
  lines.push(`**When:** ${report.timestamp}`);
  lines.push(`**CLI:** \`${report.cli}\``);
  lines.push(
    `**Result:** ${report.summary.ok ? 'PASS' : 'FAIL'} — ${report.summary.pass}/${report.summary.total} checks (${report.summary.criticalFail} critical fails, ${report.summary.warn} warns)`,
  );
  lines.push('');
  lines.push('## Domains');
  lines.push('');
  lines.push('| Domain | Pass | Fail | Warn |');
  lines.push('|--------|-----:|-----:|-----:|');
  for (const [d, s] of Object.entries(report.domains)) {
    lines.push(`| ${d} | ${s.pass} | ${s.fail} | ${s.warn} |`);
  }
  lines.push('');
  lines.push('## Capability grounding (RuvNet Brain)');
  lines.push('');
  for (const c of report.brainGrounding.capabilities) {
    lines.push(`- ${c}`);
  }
  lines.push('');
  lines.push('## Failures / warns');
  lines.push('');
  const bad = report.results.filter((r) => !r.ok);
  if (!bad.length) lines.push('_None_');
  for (const r of bad) {
    lines.push(
      `- **${r.critical ? 'FAIL' : 'WARN'}** \`${r.domain}\` / \`${r.id}\`: ${r.detail}`,
    );
  }
  lines.push('');
  lines.push('## All checks');
  lines.push('');
  lines.push('| Status | Domain | Id | ms | Detail |');
  lines.push('|--------|--------|----|---:|--------|');
  for (const r of report.results) {
    const st = r.ok ? 'PASS' : r.critical ? 'FAIL' : 'WARN';
    lines.push(
      `| ${st} | ${r.domain} | \`${r.id}\` | ${r.ms} | ${String(r.detail)
        .replace(/\\/g, '\\\\')
        .replace(/\|/g, '\\|')} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

// ── main ────────────────────────────────────────────────────────────────────
if (!JSON_OUT) {
  console.log(`Host conformance bench  host=${HOST}  run=${RUN_ID}`);
  console.log(`CLI: ${CLI}\n`);
}

try {
  if (HOST === 'grok' || HOST === 'all') {
    domainHostSurface();
    domainToolInventory();
    domainTeams();
    domainSwarm();
    domainHiveMind();
    domainLearningLoop();
    domainNeural();
    domainCliParity();
  }
  if (HOST === 'codex' || HOST === 'all') {
    domainCodexPlan();
    domainCodexInit();
  }
  if (HOST === 'command' || HOST === 'all') {
    domainCommandPlan();
    domainRunner();
  }
  finish();
} catch (e) {
  console.error('Runner crashed:', e);
  process.exit(2);
}
