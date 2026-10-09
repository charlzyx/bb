#!/usr/bin/env node
const { LorcaBridge, RPC_METHODS, validateEndpoint, validateRequest } = require('./bridge.cjs');

const { SettingsInventory, validateSettingsParams, sanitizeRendererResult } = require('./settings.cjs');

const PRIVATE_FIELDS = new Set(['path', 'workdir', 'home', 'home_path', 'serve_token', 'token', 'api_key', 'authorization', 'credentials', 'phrase', 'private_key', 'master_secret', 'machine_secret', 'account_dek', 'secret']);
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
    '方法：',
    ...RPC_METHODS.map(method => `  ${method}`),
    '',
    '省略参数时默认为 {}。查看帮助不会执行命令。',
    '命令行与桌面应用使用同一套经过校验的本地连接。',
    '仅在执行明确且有效的命令时建立连接，不会自动重发命令。',
    'settings 仅读取 bootstrap 和 mcp.list；其他命令仅执行对应的请求。',
    '会话操作命令可能修改会话或启动任务。',
    '',
    '启动配置：',
    '  LORCA_ENDPOINT       本机 ws://127.0.0.1:<port>/ws 连接地址',
    '  LORCA_PORT           未设置 LORCA_ENDPOINT 时使用的本地端口（默认 4862）',
    '  LORCA_HOME           存放 serve-token 的现有 Lorca 数据目录',
    '  LORCA_ALLOW_LEGACY=1 明确启用不带身份验证的旧版本地服务兼容模式',
    '',
    '默认模式需要现有服务的令牌。命令行不会创建账号。',
    '结果以 JSON 输出，仅包含允许的协议字段，不包含私密配置和凭据。',
    '选择文件附件仅在桌面应用中提供。',
    '',
  ].join('\n');
}
function resultJSON(value) {
  return JSON.stringify(value, (key, item) => PRIVATE_FIELDS.has(key.toLowerCase()) ? '[已隐藏]' : item, 2);
}
async function runCli(argv, options = {}) {
  const stdout = options.stdout ?? (text => process.stdout.write(text));
  const stderr = options.stderr ?? (text => process.stderr.write(text));
  const env = options.env ?? process.env;
  if (argv.length === 0 || (argv.length === 1 && ['--help', '-h'].includes(argv[0]))) { stdout(helpText()); return 0; }
  if (argv.length > 2 || typeof argv[0] !== 'string' || (!RPC_METHODS.includes(argv[0]) && argv[0] !== 'settings')) { stderr('命令未知或参数数量无效，请运行 bb-lorca --help。\n'); return 2; }
  let params;
  try { params = argv.length === 2 ? JSON.parse(argv[1]) : {}; }
  catch { stderr('参数必须是有效的 JSON，请运行 bb-lorca --help。\n'); return 2; }
  let endpoint;
  try {
    params = argv[0] === 'settings' ? validateSettingsParams(params) : validateRequest(argv[0], params);
    endpoint = validateEndpoint(env.LORCA_ENDPOINT ?? `ws://127.0.0.1:${env.LORCA_PORT ?? '4862'}/ws`);
  } catch { stderr('命令参数或连接地址无效，未发送任何请求。请运行 bb-lorca --help。\n'); return 2; }
  let bridge;
  let submitted = false;
  let settings;
  try {
    bridge = options.makeBridge ? options.makeBridge({ endpoint, home: env.LORCA_HOME, legacy: env.LORCA_ALLOW_LEGACY === '1' }) : new LorcaBridge({ endpoint, home: env.LORCA_HOME, legacy: env.LORCA_ALLOW_LEGACY === '1' });
    const status = await bridge.connect(endpoint);
    if (status.status !== 'connected') { stderr('无法连接 Lorca。请检查本地服务、LORCA_HOME 和连接地址。未发送任何请求。\n'); return 1; }
    if (status.authMode === 'legacy') stderr('警告：已明确启用旧版兼容模式，本地 Lorca 服务不带身份验证。\n');
    submitted = true;
    let result;
    if (argv[0] === 'settings') { settings = new SettingsInventory(bridge); const fence = settings.capture(); result = await settings.get(params); settings.check(fence); }
    else result = sanitizeRendererResult(argv[0], await bridge.request(argv[0], params));
    stdout(`${resultJSON(result)}\n`);
    return 0;
  } catch {
    stderr(submitted ? 'Lorca 未能完成请求。请求未被自动重发；若涉及操作，结果可能尚不确定，请先检查会话再决定是否重试。\n' : '无法初始化本地 Lorca 连接，未发送任何请求。\n');
    return 1;
  } finally { settings?.dispose(); if (bridge) bridge.close(); }
}
if (require.main === module) {
  runCli(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(() => { process.stderr.write('本地 Lorca 命令执行失败。\n'); process.exitCode = 1; });
}
module.exports = { runCli, resultJSON, helpText };
