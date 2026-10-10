import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const allowed = new Set([
  'README.md', 'docs/configuration.md',
  'packages/templates/src/templates/bb-guide-overview.md',
  'plugins/bb-guide/skills/bb-cli/SKILL.md',
  '.github/workflows/ci.yml', '.github/workflows/version-lockstep.yml',
  '.github/workflows/lorca.yml', '.github/workflows/check-lorca-fork-scope.mjs',
  '.github/workflows/check-lorca-fork-scope.test.mjs', '.github/workflows/lorca-ci.md',
]);
function sections(text, expression) {
  const result = new Map();
  let key = null;
  for (const line of text.split('\n')) {
    const match = expression.exec(line);
    if (match) { key = match[1]; assert.equal(result.has(key), false, 'Duplicate configuration section'); result.set(key, []); }
    if (key === null) { assert.equal(line.trim(), '', 'Unexpected configuration preamble'); continue; }
    result.get(key).push(line);
  }
  return new Map([...result].map(([key, lines]) => [key, lines.join('\n').trimEnd()]));
}
function lockSections(text) { return sections(text, /^(\S[^:]*):(?:\s.*)?$/); }
function lockRecords(section) { return sections(section.split('\n').slice(1).join('\n'), /^  (\S.*):(?:\s.*)?$/); }
export function assertLorcaLockfile(previous, current) {
  const before = lockSections(previous), after = lockSections(current);
  assert.deepEqual([...before.keys()].sort(), [...after.keys()].sort(), 'Root lockfile sections changed');
  for (const [section, prior] of before) {
    if (!['importers', 'packages', 'snapshots'].includes(section)) { assert.equal(after.get(section), prior, `Root lockfile ${section} changed`); continue; }
    const oldRecords = lockRecords(prior), newRecords = lockRecords(after.get(section));
    for (const [key, value] of oldRecords) {
      if (section === 'importers' && key === 'apps/lorca') continue;
      assert.equal(newRecords.get(key), value, `Existing lockfile ${section}/${key} changed`);
    }
    if (section === 'importers') for (const key of newRecords.keys()) assert.ok(oldRecords.has(key) || key === 'apps/lorca', `Non-Lorca importer ${key} added`);
  }
}
function parseTurbo(text) {
  let output = '', quoted = false, escaped = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quoted) {
      output += character;
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') { quoted = true; output += character; }
    else if (character === '/' && text[index + 1] === '/') {
      while (index < text.length && text[index] !== '\n') index++;
      output += '\n';
    } else if (character === '/' && text[index + 1] === '*') {
      const end = text.indexOf('*/', index + 2);
      assert.notEqual(end, -1, 'Unterminated Turbo configuration comment');
      index = end + 1; output += ' ';
    } else output += character;
  }
  return JSON.parse(output);
}
export function assertLorcaTurbo(previous, current) {
  const strip = text => { const value = parseTurbo(text); for (const key of Object.keys(value.tasks ?? {})) if (key.startsWith('@bb/lorca#')) delete value.tasks[key]; return value; };
  assert.deepEqual(strip(current), strip(previous), 'Non-Lorca Turbo configuration changed');
}
export function assertForkScope(paths, readPrevious, readCurrent) {
  for (const file of paths) {
    if (file.startsWith('apps/lorca/') || /^docs\/lorca-[^/]+\.md$/.test(file) || allowed.has(file)) continue;
    if (file === 'pnpm-lock.yaml') { assertLorcaLockfile(readPrevious(file), readCurrent(file)); continue; }
    if (file === 'turbo.json') { assertLorcaTurbo(readPrevious(file), readCurrent(file)); continue; }
    if (file === '.gitignore') {
      const strip = text => text.split('\n').filter(line => line.trim() && !/^\/?(?:apps\/lorca\/|docs\/lorca-screenshots\/)/.test(line)).join('\n');
      assert.equal(strip(readCurrent(file)), strip(readPrevious(file)), 'Non-Lorca ignore rules changed'); continue;
    }
    throw new Error(`Outside this fork's focused Lorca CI scope: ${file}. Configure suitable upstream checks before merging this broader change.`);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const base = process.argv[2];
    assert.match(base ?? '', /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/, 'A verified comparison commit is required');
    const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    git('cat-file', '-e', `${base}^{commit}`);
    const paths = git('diff', '--name-only', '--no-renames', '-z', base, 'HEAD', '--').split('\0').filter(Boolean);
    assertForkScope(paths, file => git('show', `${base}:${file}`), file => readFileSync(file, 'utf8'));
    console.log(`Focused Lorca scope verified for ${paths.length} changed paths. The dedicated Lorca workflow owns runtime/build/test coverage; upstream full-stack checks were not run.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
