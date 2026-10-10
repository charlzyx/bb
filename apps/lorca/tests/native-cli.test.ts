import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
const require = createRequire(import.meta.url);
const { runCli, resultJSON } = require('../native/cli.cjs');

function noIO() {
  const output: string[] = [], errors: string[] = [];
  return { output, errors, options: { stdout: (text: string) => output.push(text), stderr: (text: string) => errors.push(text), env: { LORCA_HOME: '/never/read/private-data' }, makeBridge: () => { throw new Error('No connection or credential reads are allowed'); } } };
}

test('CLI help/default does not create a connection or read credentials', async () => {
  for (const args of [[], ['--help'], ['-h']]) {
    const f = noIO(); assert.equal(await runCli(args, f.options), 0);
    assert.match(f.output.join(''), /用法：/); assert.match(f.output.join(''), /chats\.messages/);
    assert.match(f.output.join(''), /settings-action/); assert.match(f.output.join(''), /不支持管道、重定向、--yes/);
    assert.match(f.output.join(''), /dots 桌面应用的受控窗口/);
    assert.equal(f.errors.length, 0); assert.ok(!f.output.join('').includes('/never/read'));
  }
});

test('CLI rejects invalid JSON, blocked methods, invalid endpoints, and path injection before I/O', async () => {
  for (const args of [['chats.send', '{bad-secret-json'], ['providers.api_key', '{}'], ['chats.send', '{"chat_id":"c","text":"hi","attachments":[{"path":"/private/key"}]}'], ['hello', '{}', 'unexpected']]) {
    const f = noIO(); assert.equal(await runCli(args, f.options), 2); assert.equal(f.output.length, 0);
    assert.ok(!f.errors.join('').includes('/private')); assert.ok(!f.errors.join('').includes('bad-secret'));
  }
  const f = noIO(); assert.equal(await runCli(['hello'], { ...f.options, env: { LORCA_ENDPOINT: 'ws://remote.example:4862/ws' } }), 2);
});

test('CLI runs exactly one explicit command, outputs safe JSON, and closes', async () => {
  const f = noIO(); const calls: unknown[] = []; let closed = false;
  const makeBridge = () => ({
    connect: async (endpoint: string) => { calls.push(['connect', endpoint]); return { status: 'connected', authMode: 'token' }; },
    request: async (method: string, params: unknown) => { calls.push([method, params]); return { version: 'test', has_identity: true, is_identity_device: true, device_id: 'runner', relay_connected: false, relay_update_required: false, relay_url: 'private-url', token: 'secret', nested: { path: '/native/private', workdir: '/native/work' } }; },
    close: () => { closed = true; },
  });
  assert.equal(await runCli(['hello'], { ...f.options, makeBridge }), 0);
  assert.deepEqual(calls, [['connect', 'ws://127.0.0.1:4862/ws'], ['hello', {}]]); assert.equal(closed, true);
  assert.deepEqual(JSON.parse(f.output.join('')), { version: 'test', has_identity: true, is_identity_device: true, device_id: 'runner', relay_connected: false, relay_update_required: false });
  assert.equal(f.errors.length, 0);
});

test('CLI failure never prints credential or native-path error text and still closes', async () => {
  const f = noIO(); let closed = false;
  const makeBridge = () => ({ connect: async () => ({ status: 'connected', authMode: 'legacy' }), request: async () => { throw new Error('secret token at /native/private'); }, close: () => { closed = true; } });
  assert.equal(await runCli(['chats.stop', '{"chat_id":"c"}'], { ...f.options, makeBridge }), 1); assert.equal(closed, true);
  assert.match(f.errors.join(''), /本地兼容连接（不校验令牌）/); assert.match(f.errors.join(''), /结果可能尚不确定/);
  assert.ok(!f.errors.join('').includes('/native/private')); assert.ok(!f.errors.join('').includes('secret token'));
  assert.equal(resultJSON(null), 'null');
});

const secret = 'SYNTHETIC_CLI_SECRET_MUST_NOT_APPEAR';
const botAction = { kind: 'bot.update', botId: 'bot-one', model: 'fixture-fast' };
const settingsSnapshot = () => ({
  version: 'cli-fixture', has_identity: true, identity_id: 'account-one', relay_connected: true,
  devices: [{ id: 'runner-one', name: 'Fixture runner', os: 'linux', version: 'fixture', status: 'online', is_this_device: true, plugins: [] }],
  providers: [{ kind: 'deepseek', name: 'Fixture provider', api: 'chat-completions', is_connected: true, base_url: secret, api_key: secret }],
  bots: [{ id: 'bot-one', name: 'Fixture bot', provider: 'deepseek', model: 'fixture-model', thinking: null, runner_id: 'runner-one' }],
  models: [
    { provider: 'deepseek', id: 'fixture-model', name: 'Fixture model', levels: ['low', 'high'] },
    { provider: 'deepseek', id: 'fixture-fast', name: 'Fixture fast', levels: [] },
  ],
  auto_review: { is_enabled: false, rules: [] },
});
const settingsMcp = () => ({
  error: null,
  servers: [{
    name: 'Fixture notes', transport: 'stdio', enabled: true, problem: null,
    config: { command: 'fixture-program', args: [secret], env: { KEY: secret } },
    status: { id: 'fixture-notes', name: 'Fixture notes', state: 'ready' },
    tool_count: 1,
  }],
});

class CliSettingsBridge extends EventEmitter {
  status = { status: 'connected', generation: 1, authMode: 'token' };
  calls: { method: string; params: Record<string, unknown> }[] = [];
  closed = false;
  handler: (method: string, params: Record<string, unknown>) => Promise<unknown> = async (method) => {
    if (method === 'bootstrap') return settingsSnapshot();
    if (method === 'mcp.list') return settingsMcp();
    return { token: secret, path: secret };
  };
  getStatus = () => ({ ...this.status });
  connect = async () => this.getStatus();
  request = async () => { throw new Error('A settings action must not use the public raw RPC path'); };
  sendValidated = async (method: string, params: Record<string, unknown>) => {
    this.calls.push({ method, params: structuredClone(params) });
    return this.handler(method, params);
  };
  close = () => { this.closed = true; };
}

function settingsFixture(question: (prompt: string) => Promise<unknown> = async () => '确认') {
  const capture = noIO(), bridge = new CliSettingsBridge(), prompts: string[] = [];
  const options = {
    ...capture.options,
    makeBridge: () => bridge,
    stdin: { isTTY: true },
    stdoutStream: { isTTY: true },
    stderrStream: { isTTY: true },
    question: async (prompt: string) => {
      prompts.push(prompt);
      return question(prompt);
    },
  };
  return { ...capture, bridge, prompts, options };
}

const writes = (bridge: CliSettingsBridge) => bridge.calls.filter((call) => !['bootstrap', 'mcp.list'].includes(call.method));

test('settings-action rejects supplied revisions and secret-bearing fields before connection', async () => {
  for (const value of [
    { ...botAction, revision: 'a-revision-from-another-process' },
    { ...botAction, api_key: secret },
    { kind: 'mcp.setEnabled', runnerId: 'runner-one', name: 'Fixture notes', enabled: true, env: { KEY: secret } },
    { kind: 'autoReview.set', isEnabled: true, rules: [{ text: 'Test rule', behavior: 'allow', headers: { Authorization: secret } }] },
    { kind: 'providers.connect_deepseek', api_key: secret },
  ]) {
    const f = noIO();
    assert.equal(await runCli(['settings-action', JSON.stringify(value)], f.options), 2);
    assert.equal(f.output.length, 0);
    assert.equal(f.errors.join('').includes(secret), false);
  }
});

test('credential and MCP configuration commands direct to the controlled desktop window without I/O', async () => {
  for (const value of [
    { kind: 'provider.configure', providerId: 'deepseek', apiKey: secret },
    { kind: 'mcp.configure', runnerId: 'runner-one', patch: { env: { KEY: secret } } },
  ]) {
    const f = noIO();
    assert.equal(await runCli(['settings-action', JSON.stringify(value)], f.options), 2);
    assert.match(f.errors.join(''), /dots 桌面应用的受控窗口/);
    assert.match(f.errors.join(''), /focused\.mjs desktop/);
    assert.equal(f.errors.join('').includes(secret), false);
    assert.equal(f.output.length, 0);
  }
});

test('settings-action refuses every non-TTY stream and cannot be enabled with --yes', async () => {
  for (const stream of ['stdin', 'stdoutStream', 'stderrStream']) {
    const f = noIO();
    const options = { ...f.options, stdin: { isTTY: true }, stdoutStream: { isTTY: true }, stderrStream: { isTTY: true }, [stream]: { isTTY: false } };
    assert.equal(await runCli(['settings-action', JSON.stringify(botAction)], options), 2);
    assert.match(f.errors.join(''), /交互式终端/);
    assert.equal(f.output.length, 0);
  }
  const f = noIO();
  assert.equal(await runCli(['settings-action', JSON.stringify(botAction), '--yes'], f.options), 2);
});

test('settings-action obtains its fresh revision in-process, confirms, and performs exactly one shared transaction', async () => {
  const f = settingsFixture(async () => {
    assert.equal(writes(f.bridge).length, 0);
    return '确认';
  });
  assert.equal(await runCli(['settings-action', JSON.stringify(botAction)], f.options), 0);
  assert.deepEqual(writes(f.bridge), [{ method: 'bots.update', params: { id: 'bot-one', model: 'fixture-fast' } }]);
  assert.deepEqual(f.bridge.calls.map((call) => call.method), ['bootstrap', 'mcp.list', 'bootstrap', 'bootstrap', 'bots.update']);
  assert.equal(f.prompts.length, 1);
  assert.match(f.prompts[0], /Fixture bot/);
  assert.match(f.prompts[0], /影响所有/);
  assert.match(f.prompts[0], /输入“确认”/);
  assert.deepEqual(JSON.parse(f.output.join('')), { status: 'applied' });
  assert.equal([...f.output, ...f.errors, ...f.prompts].join('').includes(secret), false);
  assert.equal(f.bridge.closed, true);
  assert.equal(f.bridge.listenerCount('event'), 0);
});

test('CLI MCP actions use the selected runner without exposing argument or environment secrets', async () => {
  const f = settingsFixture();
  const value = { kind: 'mcp.setEnabled', runnerId: 'runner-one', name: 'Fixture notes', enabled: false };
  assert.equal(await runCli(['settings-action', JSON.stringify(value)], f.options), 0);
  assert.deepEqual(writes(f.bridge), [{ method: 'mcp.set_enabled', params: { name: 'Fixture notes', enabled: false, runner_id: 'runner-one' } }]);
  assert.ok(f.bridge.calls.filter((call) => call.method === 'mcp.list').every((call) => call.params.runner_id === 'runner-one'));
  assert.equal([...f.output, ...f.errors, ...f.prompts].join('').includes(secret), false);
  assert.equal(f.output.join('').includes('fixture-program'), false);
});

for (const answer of ['', 'no', 'yes', true]) {
  test(`CLI settings confirmation ${JSON.stringify(answer)} cancels instead of writing`, async () => {
    const f = settingsFixture(async () => answer);
    assert.equal(await runCli(['settings-action', JSON.stringify(botAction)], f.options), 0);
    assert.deepEqual(JSON.parse(f.output.join('')), { status: 'cancelled' });
    assert.equal(writes(f.bridge).length, 0);
    assert.equal(f.bridge.closed, true);
  });
}

test('CLI settings confirmation cannot authorize changes after account or connection replacement', async () => {
  for (const boundary of ['identity', 'connection']) {
    const f = settingsFixture(async () => {
      if (boundary === 'identity') f.bridge.emit('event', { event: 'identity.changed', data: { has_identity: true } });
      else f.bridge.status.generation++;
      return '确认';
    });
    assert.equal(await runCli(['settings-action', JSON.stringify(botAction)], f.options), 1);
    assert.equal(writes(f.bridge).length, 0);
    assert.equal(f.output.length, 0);
    assert.equal(f.bridge.closed, true);
  }
});

test('CLI settings confirmation rejects a stale baseline changed during the prompt', async () => {
  const f = settingsFixture(async () => {
    f.bridge.handler = async (method) => {
      if (method === 'bootstrap') {
        const changed = settingsSnapshot();
        changed.bots[0].model = 'fixture-fast';
        return changed;
      }
      return settingsMcp();
    };
    return '确认';
  });
  assert.equal(await runCli(['settings-action', JSON.stringify(botAction)], f.options), 1);
  assert.equal(writes(f.bridge).length, 0);
  assert.equal(f.output.length, 0);
});

test('CLI settings writes fail closed when the terminal is lost during confirmation', async () => {
  const f = settingsFixture(async () => {
    f.options.stdin.isTTY = false;
    return '确认';
  });
  assert.equal(await runCli(['settings-action', JSON.stringify(botAction)], f.options), 1);
  assert.equal(writes(f.bridge).length, 0);
  assert.equal(f.output.length, 0);
});

test('CLI settings unknown outcomes are explicit, private, nonzero, and never replayed', async () => {
  const f = settingsFixture();
  f.bridge.handler = async (method) => {
    if (method === 'bootstrap') return settingsSnapshot();
    if (method === 'mcp.list') return settingsMcp();
    throw new Error(`Unknown outcome with ${secret} at /private/fixture`);
  };
  assert.equal(await runCli(['settings-action', JSON.stringify(botAction)], f.options), 1);
  assert.deepEqual(JSON.parse(f.output.join('')), { status: 'unknownOutcome' });
  assert.equal(writes(f.bridge).length, 1);
  assert.match(f.errors.join(''), /结果尚不确定/);
  assert.match(f.errors.join(''), /未自动重发/);
  assert.equal([...f.output, ...f.errors, ...f.prompts].join('').includes(secret), false);
  assert.equal(f.errors.join('').includes('/private/fixture'), false);
  assert.equal(f.bridge.closed, true);
});

test('CLI settings prompt exceptions reveal no raw errors and leave changes unsent', async () => {
  const f = settingsFixture(async () => { throw new Error(secret); });
  assert.equal(await runCli(['settings-action', JSON.stringify(botAction)], f.options), 1);
  assert.equal(writes(f.bridge).length, 0);
  assert.equal([...f.output, ...f.errors].join('').includes(secret), false);
  assert.equal(f.bridge.closed, true);
});

for (const response of ['confirm', 'close'] as const) {
  test(`the actual CLI readline prompt handles mock-terminal ${response} without process I/O`, async () => {
    const f = settingsFixture();
    const input = Object.assign(new PassThrough(), { isTTY: true });
    const output = Object.assign(new PassThrough(), { isTTY: true });
    const terminal = Object.assign(new PassThrough(), { isTTY: true });
    let text = '', answered = false;
    terminal.on('data', (value: Buffer) => {
      text += value.toString();
      if (!answered && text.includes('其他输入取消')) {
        answered = true;
        queueMicrotask(() => response === 'confirm' ? input.write('确认\n') : input.end());
      }
    });
    try {
      const options = { ...f.options, stdin: input, stdoutStream: output, stderrStream: terminal, question: undefined };
      assert.equal(await runCli(['settings-action', JSON.stringify(botAction)], options), 0);
      assert.equal(answered, true);
      assert.deepEqual(JSON.parse(f.output.join('')), { status: response === 'confirm' ? 'applied' : 'cancelled' });
      assert.equal(writes(f.bridge).length, response === 'confirm' ? 1 : 0);
      assert.equal(text.includes(secret), false);
    } finally {
      input.destroy(); output.destroy(); terminal.destroy();
    }
  });
}
