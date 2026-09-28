/**
 * runHeadlessProcess / buildWorkerEnvironment — the process and env helpers
 * shared by the dual-mode orchestrator and the CLI team runner.
 */
import { describe, it, expect } from 'vitest';
import { runHeadlessProcess, buildWorkerEnvironment } from '../src/dual-mode/index.js';

const node = process.execPath;

describe('runHeadlessProcess', () => {
  it('writes stdin, closes it, and returns the exit code', async () => {
    const result = await runHeadlessProcess({
      command: node,
      args: ['-e', "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{process.stdout.write('got:'+s);process.exit(4)})"],
      cwd: process.cwd(),
      env: process.env,
      stdinText: 'hello',
      timeoutMs: 5000,
      maxOutputBytes: 1024,
    });
    expect(result.stdout).toBe('got:hello');
    expect(result.code).toBe(4);
    expect(result.timedOut).toBe(false);
  });

  it('closes stdin even when no text is sent', async () => {
    const result = await runHeadlessProcess({
      command: node,
      args: ['-e', "process.stdin.resume();process.stdin.on('end',()=>process.stdout.write('eof'))"],
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 3000,
      maxOutputBytes: 1024,
    });
    expect(result.stdout).toBe('eof');
    expect(result.code).toBe(0);
  });

  it('times out and reports timedOut', async () => {
    const result = await runHeadlessProcess({
      command: node,
      args: ['-e', 'setTimeout(()=>{}, 10000)'],
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 200,
      maxOutputBytes: 1024,
    });
    expect(result.timedOut).toBe(true);
    expect(result.code).toBeNull();
    expect(result.ms).toBeLessThan(3000);
  });

  it('caps captured output at maxOutputBytes', async () => {
    const result = await runHeadlessProcess({
      command: node,
      args: ['-e', "process.stdout.write('x'.repeat(5000))"],
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 5000,
      maxOutputBytes: 100,
    });
    expect(result.stdout.length).toBe(100);
  });

  it('rejects when the command cannot be spawned', async () => {
    await expect(runHeadlessProcess({
      command: 'definitely-not-a-real-command-xyz',
      args: [],
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 1000,
      maxOutputBytes: 100,
    })).rejects.toThrow();
  });
});

describe('buildWorkerEnvironment', () => {
  const base = {
    PATH: '/bin',
    FOO_TOKEN: 'secret',
    OPENAI_API_KEY: 'sk-test',
    CLAUDE_FLOW_POLICY_MODE: 'x',
    CLAUDE_FLOW_PRINCIPAL_ID: 'someone-else',
  };

  it('strips sensitive names and sets the worker identity', () => {
    const env = buildWorkerEnvironment(base, { principalId: 'agent:w1', dbPath: '/db', envelope: { tools: ['a'] } });
    expect(env.PATH).toBe('/bin');
    expect(env.FOO_TOKEN).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.CLAUDE_FLOW_POLICY_MODE).toBeUndefined();
    expect(env.CLAUDE_FLOW_PRINCIPAL_ID).toBe('agent:w1');
    expect(env.CLAUDE_FLOW_DB_PATH).toBe('/db');
    expect(env.FORCE_COLOR).toBe('0');
    expect(JSON.parse(env.CLAUDE_FLOW_CAPABILITY_ENVELOPE!)).toEqual({ tools: ['a'] });
  });

  it('re-adds passEnv names after the strip', () => {
    const env = buildWorkerEnvironment(base, { principalId: 'agent:w1', passEnv: ['OPENAI_API_KEY', 'MISSING'] });
    expect(env.OPENAI_API_KEY).toBe('sk-test');
    expect(env.FOO_TOKEN).toBeUndefined();
    expect('MISSING' in env).toBe(false);
    expect(env.CLAUDE_FLOW_CAPABILITY_ENVELOPE).toBeUndefined();
  });
});
