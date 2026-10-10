import assert from 'node:assert/strict';
import { test } from 'node:test';
import { demoRuntimeSettings } from '../src/core/demo';
import { parseRuntimeSettings, parseSettingsEditor } from '../src/core/settings';

test('editor parser retains typed capabilities and rule scope without unknown secret fields', () => {
  const editor = structuredClone(demoRuntimeSettings.editor!);
  const projected = parseSettingsEditor({ ...editor, api_key: 'never-render', rawConfig: { secret: 'never-render' } });
  assert.deepEqual(projected, editor);
  assert.ok(!JSON.stringify(projected).includes('never-render'));
  projected.autoReview.rules[0]!.text = 'changed';
  assert.notEqual(projected.autoReview.rules[0]!.text, editor.autoReview.rules[0]!.text);
  const oldBridge = structuredClone(demoRuntimeSettings);
  delete oldBridge.editor;
  assert.equal(parseRuntimeSettings(oldBridge).editor, undefined);
});

test('editor parser fails closed for unsupported rule behavior, malformed flags and unbounded values', () => {
  const original = demoRuntimeSettings.editor!;
  for (const editor of [
    { ...original, revision: '' },
    { ...original, canManageMcp: 'yes' },
    { ...original, models: [{ provider: 'p', id: 'm', name: 'model', levels: null }] },
    { ...original, autoReview: { ...original.autoReview, status: 'unknown' } },
    { ...original, autoReview: { ...original.autoReview, rules: [{ id: 'r', text: 'rule', behavior: 'ALLOW', tool: null }] } },
    { ...original, autoReview: { ...original.autoReview, rules: [{ id: 'r', text: 'x'.repeat(20_001), behavior: 'ask', tool: null }] } },
    { ...original, providers: Array(1001).fill({ id: 'p', canConfigure: false, canDisconnect: false }) },
  ]) assert.throws(() => parseSettingsEditor(editor), /设置数据格式不兼容/);
});


test('pairing capabilities fail closed and never project invitation secrets', () => {
  const input = { ...demoRuntimeSettings, pairingCapabilities: { invite: true, join: false, pairing_string: 'secret-pairing-code' } };
  const result = parseRuntimeSettings(input);
  assert.deepEqual(result.pairingCapabilities, { invite: true, join: false });
  assert.ok(!JSON.stringify(result).includes('secret-pairing-code'));
  assert.throws(() => parseRuntimeSettings({ ...input, pairingCapabilities: { invite: 1, join: false } }));
  assert.throws(() => parseRuntimeSettings({ ...input, pairingCapabilities: null }));
});
