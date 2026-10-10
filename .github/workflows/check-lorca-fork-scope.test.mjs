import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertForkScope, assertLorcaLockfile, assertLorcaTurbo } from './check-lorca-fork-scope.mjs';

const lock = "lockfileVersion: '9.0'\n\nsettings:\n  autoInstallPeers: true\n\nimporters:\n\n  .:\n    dependencies: {}\n\n  apps/app:\n    dependencies: {}\n\npackages:\n\n  existing@1.0.0:\n    resolution: {integrity: old}\n\nsnapshots:\n\n  existing@1.0.0: {}\n";
const lorcaLock = lock.replace('packages:', '  apps/lorca:\n    dependencies: {}\n\npackages:').replace('snapshots:', '  new@2.0.0:\n    resolution: {integrity: new}\n\nsnapshots:') + '\n  new@2.0.0: {}\n';
test('only Lorca, named documentation and CI files qualify without configuration inspection', () => {
  assertForkScope(['apps/lorca/native/main.cjs', 'docs/lorca-settings.md', 'README.md', '.github/workflows/lorca.yml'], () => '', () => '');
  for (const file of ['apps/app/src/main.tsx', 'packages/shared-ui/src/button.tsx', 'package.json', 'pnpm-workspace.yaml', '.github/workflows/deploy-web.yml', 'scripts/plan-ci.mjs']) assert.throws(() => assertForkScope([file], () => '', () => ''), /Outside/);
});
test('lockfile may add only the Lorca importer and new dependency records', () => {
  assert.doesNotThrow(() => assertLorcaLockfile(lock, lorcaLock));
  for (const changed of [lorcaLock.replace('apps/app:', 'apps/other:'), lorcaLock.replace('integrity: old', 'integrity: replaced'), lorcaLock.replace('autoInstallPeers: true', 'autoInstallPeers: false'), lorcaLock.replace('apps/lorca:', 'apps/unrelated:'), lorcaLock.replace('existing@1.0.0: {}', 'existing@1.0.0: {dependencies: {changed: 2.0.0}}'), lorcaLock.replace("lockfileVersion: '9.0'", "lockfileVersion: '8.0'")]) assert.throws(() => assertLorcaLockfile(lock, changed));
});
test('Turbo allows only Lorca task overrides and preserves all shared defaults', () => {
  const base = { globalEnv: ['X'], tasks: { build: { dependsOn: ['^build'] } } };
  assertLorcaTurbo(JSON.stringify(base), JSON.stringify({ ...base, tasks: { ...base.tasks, '@bb/lorca#build': { dependsOn: ['topo'] } } }));
  assert.throws(() => assertLorcaTurbo(JSON.stringify(base), JSON.stringify({ ...base, globalEnv: ['Y'] })));
  assert.throws(() => assertLorcaTurbo(JSON.stringify(base), JSON.stringify({ ...base, tasks: {} })));
});
test('ignore-file exceptions cannot hide unrelated workspace changes', () => {
  const before = 'node_modules/\n';
  assertForkScope(['.gitignore'], () => before, () => before + '/apps/lorca/dots-macos-dev-*/\n/docs/lorca-screenshots/\n');
  assert.throws(() => assertForkScope(['.gitignore'], () => before, () => before + '/packages/\n'));
});

test('Turbo comments are accepted without changing literal URL or comment-like strings', () => {
  const base = '{"tasks":{"build":{"env":["https://example.invalid","/* literal */"]}}}';
  const annotated = '/* note */\n' + base.replace('"tasks"', '// heading\n"tasks"');
  assert.doesNotThrow(() => assertLorcaTurbo(base, annotated));
  assert.throws(() => assertLorcaTurbo(base, annotated.replace('example.invalid', 'other.invalid')));
});
