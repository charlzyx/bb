#!/usr/bin/env node
const { LorcaBridge, RPC_METHODS, validateEndpoint, validateRequest } = require('./bridge.cjs');
const { SettingsInventory, validateSettingsParams, sanitizeRendererResult } = require('./settings.cjs');
const { SettingsEditor, validateSettingsAction } = require('./settings-editor.cjs');
const { createInterface } = require('node:readline/promises');

const PRIVATE_FIELDS = new Set(['path', 'workdir', 'home', 'home_path', 'serve_token', 'token', 'api_key', 'authorization', 'credentials', 'phrase', 'private_key', 'master_secret', 'machine_secret', 'account_dek', 'secret']);
const SETTINGS_ACTIONS = ['bot.update', 'provider.disconnect', 'mcp.setEnabled', 'mcp.remove', 'mcp.reconnect', 'mcp.reload', 'autoReview.set'];
const DESKTOP_SETTINGS = '凭据和 MCP 配置仅可在 dots 桌面应用的受控窗口中编辑，命令行不接受密钥或配置内容。请在仓库根目录运行 node apps/lorca/scripts/focused.mjs desktop，再打开 dots → 设置。';
function helpText() {
  return [
    'dots 本地命令行（Lorca 协议）',
    '',
    "用法：bb-lorca <method> '<JSON 参数>'",
    "      node native/cli.cjs <method> '<JSON 参数>'",
    '       bb-lorca --help',
    '',
    '只读配置概览：',
    `  settings '{"runnerId":"RUNNER_ID"}' （runnerId 可选）`,
    '',
    '交互式设置变更（仅接受非敏感字段）：',
    `  settings-action '{"kind":"bot.update","botId":"BOT_ID","model":"MODEL_ID"}'`,
    `  settings-action '{"kind":"mcp.setEnabled","runnerId":"RUNNER_ID","name":"MCP_NAME","enabled":false}'`,
    `  支持：${SETTINGS_ACTIONS.join('、')}`,
    '  不要提供 revision；命令会在同一进程内读取最新设置并取得临时编辑版本。',
    '  stdin、stdout、stderr 必须连接终端；核对确认提示后输入“确认”才会提交。',
    '  不支持管道、重定向、--yes 或无人值守写入；不会自动重发变更。',
    `  ${DESKTOP_SETTINGS}`,
    '',
    '方法：',
    ...RPC_METHODS.map(method => `  ${method}`),
    '',
    '省略参数时默认为 {}。查看帮助不会执行命令。',
    '命令行与桌面应用使用同一套经过校验的本地连接。',
    '仅在执行明确且有效的命令时建立连接，不会自动重发命令。',
    'settings 仅读取 bootstrap 和 mcp.list；settings-action 使用与桌面相同的事务校验和会话隔离。',
    '其他命令仅执行对应的请求。settings-action 仅输出 applied、cancelled 或 unknownOutcome 状态。',
    '会话操作命令可能修改会话或启动任务。',
    '',
    '启动配置：',
    '  LORCA_ENDPOINT       本机 ws://127.0.0.1:<port>/ws 连接地址',
    '  LORCA_PORT           未设置 LORCA_ENDPOINT 时使用的本地端口（默认 4862）',
    '  LORCA_HOME           存放 serve-token 的现有 Lorca 数据目录',
    '  LORCA_ALLOW_LEGACY=1 明确启用本地兼容连接（不校验令牌）',
    '',
    '默认使用本地令牌认证，需要现有服务的令牌。命令行不会创建账号。',
    '结果以 JSON 输出，仅包含允许的协议字段，不包含私密配置和凭据。',
    '选择文件附件仅在桌面应用中提供。',
    '',
  ].join('\n');
}
function resultJSON(value) {
  return JSON.stringify(value, (key, item) => PRIVATE_FIELDS.has(key.toLowerCase()) ? '[已隐藏]' : item, 2);
}
function settingsActionParams(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.hasOwn(value, 'revision') || !SETTINGS_ACTIONS.includes(value.kind)) throw new Error('设置操作参数无效');
  const action = validateSettingsAction({ ...value, revision: 'cli-pending-revision' });
  delete action.revision;
  return action;
}
function terminalText(value) {
  return String(value).replace(/[\x00-\x08\x0b-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, '');
}
async function terminalQuestion(prompt, input, output) {
  const terminal = createInterface({ input, output, terminal: true });
  try {
    terminal.once('SIGINT', () => terminal.close());
    return await Promise.race([terminal.question(prompt), new Promise(resolve => terminal.once('close', () => resolve('')))]);
  } finally { terminal.close(); }
}
async function runCli(argv, options = {}) {
  const stdout = options.stdout ?? (text => process.stdout.write(text));
  const stderr = options.stderr ?? (text => process.stderr.write(text));
  const env = options.env ?? process.env;
  const input = options.stdin ?? process.stdin;
  const output = options.stdoutStream ?? process.stdout;
  const terminal = options.stderrStream ?? process.stderr;
  const interactive = () => input.isTTY === true && output.isTTY === true && terminal.isTTY === true;
  if (argv.length === 0 || (argv.length === 1 && ['--help', '-h'].includes(argv[0]))) { stdout(helpText()); return 0; }
  if (argv.length > 2 || typeof argv[0] !== 'string' || (!RPC_METHODS.includes(argv[0]) && !['settings', 'settings-action'].includes(argv[0]))) { stderr('命令未知或参数数量无效，请运行 bb-lorca --help。\n'); return 2; }
  let params;
  try { params = argv.length === 2 ? JSON.parse(argv[1]) : {}; }
  catch { stderr('参数必须是有效的 JSON，请运行 bb-lorca --help。\n'); return 2; }
  if (argv[0] === 'settings-action' && ['provider.configure', 'mcp.configure'].includes(params?.kind)) { stderr(`${DESKTOP_SETTINGS}\n`); return 2; }
  let endpoint;
  try {
    params = argv[0] === 'settings' ? validateSettingsParams(params) : argv[0] === 'settings-action' ? settingsActionParams(params) : validateRequest(argv[0], params);
    endpoint = validateEndpoint(env.LORCA_ENDPOINT ?? `ws://127.0.0.1:${env.LORCA_PORT ?? '4862'}/ws`);
  } catch { stderr('命令参数或连接地址无效，未发送任何请求。请运行 bb-lorca --help。\n'); return 2; }
  if (argv[0] === 'settings-action' && !interactive()) { stderr('设置变更需要 stdin、stdout、stderr 均连接交互式终端；不允许管道、重定向或无人值守写入。未建立连接。\n'); return 2; }
  let bridge;
  let submitted = false;
  let settings;
  let editor;
  try {
    bridge = options.makeBridge ? options.makeBridge({ endpoint, home: env.LORCA_HOME, legacy: env.LORCA_ALLOW_LEGACY === '1' }) : new LorcaBridge({ endpoint, home: env.LORCA_HOME, legacy: env.LORCA_ALLOW_LEGACY === '1' });
    const status = await bridge.connect(endpoint);
    if (status.status !== 'connected') { stderr('无法连接 Lorca。请检查本地服务、LORCA_HOME 和连接地址。未发送任何请求。\n'); return 1; }
    if (status.authMode === 'legacy') stderr('警告：已明确启用本地兼容连接（不校验令牌）。仅连接你信任的本机服务。\n');
    submitted = true;
    let result;
    if (argv[0] === 'settings') { settings = new SettingsInventory(bridge); const fence = settings.capture(); result = await settings.get(params); settings.check(fence); }
    else if (argv[0] === 'settings-action') {
      const trusted = () => { if (!interactive()) throw new Error('设置变更需要交互式终端'); };
      settings = new SettingsInventory(bridge);
      editor = new SettingsEditor(bridge, settings, {
        confirm: async ({ title, message, detail }) => {
          trusted();
          const prompt = `${[title, message, detail].map(terminalText).join('\n\n')}\n\n输入“确认”提交，其他输入取消：`;
          const answer = options.question ? await options.question(prompt) : await terminalQuestion(prompt, input, terminal);
          trusted();
          return typeof answer === 'string' && answer.trim() === '确认';
        },
      });
      settings.editor = editor;
      const fence = settings.capture();
      const fresh = await settings.get(params.runnerId === undefined ? {} : { runnerId: params.runnerId });
      settings.check(fence);
      if (!fresh.editor?.revision) throw new Error('设置编辑当前不可用');
      const applied = await editor.apply({ ...params, revision: fresh.editor.revision }, trusted);
      if (!['applied', 'cancelled', 'unknownOutcome'].includes(applied?.status)) throw new Error('设置操作结果无效');
      result = { status: applied.status };
      stdout(`${resultJSON(result)}\n`);
      if (result.status === 'unknownOutcome') { stderr('变更结果尚不确定。未自动重发，请先检查设置，再决定是否重新执行。\n'); return 1; }
      return 0;
    }
    else result = sanitizeRendererResult(argv[0], await bridge.request(argv[0], params));
    stdout(`${resultJSON(result)}\n`);
    return 0;
  } catch {
    stderr(submitted ? argv[0] === 'settings-action' ? '无法完成设置操作。未自动重发，请先检查设置后再决定是否重试。\n' : 'Lorca 未能完成请求。请求未被自动重发；若涉及操作，结果可能尚不确定，请先检查会话再决定是否重试。\n' : '无法初始化本地 Lorca 连接，未发送任何请求。\n');
    return 1;
  } finally { editor?.dispose(); settings?.dispose(); if (bridge) bridge.close(); }
}
if (require.main === module) {
  runCli(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(() => { process.stderr.write('本地 Lorca 命令执行失败。\n'); process.exitCode = 1; });
}
module.exports = { runCli, resultJSON, helpText };
