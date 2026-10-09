#!/usr/bin/env node
const { LorcaBridge, RPC_METHODS, validateEndpoint, validateRequest } = require('./bridge.cjs');

const { SettingsInventory, validateSettingsParams, sanitizeRendererResult } = require('./settings.cjs');

const PRIVATE_FIELDS = new Set(['path', 'workdir', 'home', 'home_path', 'serve_token', 'token', 'api_key', 'authorization', 'credentials', 'phrase', 'private_key', 'master_secret', 'machine_secret', 'account_dek', 'secret']);
function helpText() {
  return [
    'BB · Lorca local CLI',
    '',
    "Usage: bb-lorca <method> '<json params>'",
    "       node native/cli.cjs <method> '<json params>'",
    '       bb-lorca --help',
    '',
    'Read-only inventory:',
    `  settings '{"runnerId":"RUNNER_ID"}' (runnerId is optional)`,
    '',
    'Methods:',
    ...RPC_METHODS.map(method => `  ${method}`),
    '',
    'Omitted parameters default to {}. No command runs when showing help.',
    'This uses the same validated local bridge as the desktop app.',
    'It connects only for an explicit valid command and never replays it.',
    'Settings reads bootstrap and mcp.list only; other commands perform their named request.',
    'Chat mutation commands can change chats or start work.',
    '',
    'Launch configuration:',
    '  LORCA_ENDPOINT       Loopback ws://127.0.0.1:<port>/ws endpoint',
    '  LORCA_PORT           Local port when LORCA_ENDPOINT is unset (default 4862)',
    '  LORCA_HOME           Existing Lorca data directory holding serve-token',
    '  LORCA_ALLOW_LEGACY=1 Explicit unauthenticated old-daemon compatibility',
    '',
    'Default mode requires the existing daemon token. The CLI does not create accounts.',
    'Results are JSON with allowlisted protocol fields. Configuration and credentials are omitted.',
    'File attachment selection is available only in the desktop app.',
    '',
  ].join('\n');
}
function resultJSON(value) {
  return JSON.stringify(value, (key, item) => PRIVATE_FIELDS.has(key.toLowerCase()) ? '[redacted]' : item, 2);
}
async function runCli(argv, options = {}) {
  const stdout = options.stdout ?? (text => process.stdout.write(text));
  const stderr = options.stderr ?? (text => process.stderr.write(text));
  const env = options.env ?? process.env;
  if (argv.length === 0 || (argv.length === 1 && ['--help', '-h'].includes(argv[0]))) { stdout(helpText()); return 0; }
  if (argv.length > 2 || typeof argv[0] !== 'string' || (!RPC_METHODS.includes(argv[0]) && argv[0] !== 'settings')) { stderr('Unknown command or invalid argument count. Run bb-lorca --help.\n'); return 2; }
  let params;
  try { params = argv.length === 2 ? JSON.parse(argv[1]) : {}; }
  catch { stderr('Parameters must be valid JSON. Run bb-lorca --help.\n'); return 2; }
  let endpoint;
  try {
    params = argv[0] === 'settings' ? validateSettingsParams(params) : validateRequest(argv[0], params);
    endpoint = validateEndpoint(env.LORCA_ENDPOINT ?? `ws://127.0.0.1:${env.LORCA_PORT ?? '4862'}/ws`);
  } catch { stderr('Invalid command parameters or endpoint. Nothing was sent. Run bb-lorca --help.\n'); return 2; }
  let bridge;
  let submitted = false;
  let settings;
  try {
    bridge = options.makeBridge ? options.makeBridge({ endpoint, home: env.LORCA_HOME, legacy: env.LORCA_ALLOW_LEGACY === '1' }) : new LorcaBridge({ endpoint, home: env.LORCA_HOME, legacy: env.LORCA_ALLOW_LEGACY === '1' });
    const status = await bridge.connect(endpoint);
    if (status.status !== 'connected') { stderr('Could not connect to Lorca. Check the daemon, LORCA_HOME, and local endpoint. Nothing was sent.\n'); return 1; }
    if (status.authMode === 'legacy') stderr('Warning: explicit legacy mode uses an unauthenticated local Lorca daemon.\n');
    submitted = true;
    let result;
    if (argv[0] === 'settings') { settings = new SettingsInventory(bridge); const fence = settings.capture(); result = await settings.get(params); settings.check(fence); }
    else result = sanitizeRendererResult(argv[0], await bridge.request(argv[0], params));
    stdout(`${resultJSON(result)}\n`);
    return 0;
  } catch {
    stderr(submitted ? 'Lorca did not complete the request successfully. No request was replayed; for actions, check the chat before retrying because the outcome may be unknown.\n' : 'Could not initialize the local Lorca connection. Nothing was sent.\n');
    return 1;
  } finally { settings?.dispose(); if (bridge) bridge.close(); }
}
if (require.main === module) {
  runCli(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(() => { process.stderr.write('The local Lorca command failed.\n'); process.exitCode = 1; });
}
module.exports = { runCli, resultJSON, helpText };
