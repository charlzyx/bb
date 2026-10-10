import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { demoRuntimeSettings } from '../core/demo';
import { parseRuntimeSettings } from '../core/settings';
import { DevicesPanel } from './settings/DevicesPanel';

const open = async () => { throw new Error('Rendering must never open pairing'); };

test('device pairing lists authentication and HTTPS restrictions together without claiming server incompatibility', () => {
  const runtime = parseRuntimeSettings({ ...demoRuntimeSettings, authMode: 'legacy', hasIdentity: true, pairingCapabilities: { invite: false, join: false, inviteReasons: ['token_auth_required', 'https_relay_required'], joinReasons: ['token_auth_required', 'already_has_identity'], relay_url: 'PRIVATE_RELAY_SENTINEL' } });
  const html = renderToStaticMarkup(<DevicesPanel runtime={runtime} onOpenPairing={open} />);
  assert.match(html, /data-pairing-disabled-reason="token_auth_required"/);
  assert.match(html, /data-pairing-disabled-reason="https_relay_required"/);
  assert.match(html, /本地兼容连接（不校验令牌）/);
  assert.match(html, /这是客户端限制，不代表本地服务不支持配对/);
  assert.match(html, /HTTPS 安全要求/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>配对新设备<\/button>/);
  assert.doesNotMatch(html, /PRIVATE_RELAY_SENTINEL|本地服务未提供此配对流程/);
});

test('device pairing distinguishes a missing bridge, missing report, offline connection and unknown operation', () => {
  const oldRuntime = parseRuntimeSettings({ ...demoRuntimeSettings, hasIdentity: true, pairingCapabilities: { invite: false, join: false } });
  const missingReport = renderToStaticMarkup(<DevicesPanel runtime={oldRuntime} onOpenPairing={open} />);
  assert.match(missingReport, /data-pairing-disabled-reason="not_reported"/);
  assert.match(missingReport, /尚未验证本地服务是否支持配对/);
  const bridge = renderToStaticMarkup(<DevicesPanel runtime={oldRuntime} />);
  assert.match(bridge, /data-pairing-disabled-reason="bridge_unavailable"/);
  assert.match(bridge, /桌面桥接组件缺少配对入口/);
  const offline = renderToStaticMarkup(<DevicesPanel runtime={oldRuntime} connected={false} onOpenPairing={open} />);
  assert.match(offline, /data-pairing-disabled-reason="not_connected"/);
  const locked = parseRuntimeSettings({ ...oldRuntime, pairingCapabilities: { invite: false, join: false, inviteReasons: ['unknown_outcome'], joinReasons: ['already_has_identity'] } });
  const unknown = renderToStaticMarkup(<DevicesPanel runtime={locked} onOpenPairing={open} />);
  assert.match(unknown, /官方客户端核对设备/); assert.match(unknown, /重连不代表撤销/);
  assert.doesNotMatch(unknown, /不支持配对|未提供此配对流程/);
});
