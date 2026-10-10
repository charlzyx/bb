import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./electron-inspector-smoke.mjs', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('electron-inspector-smoke.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);

test('every Electron application.evaluate payload is accepted as the second callback argument', () => {
  let calls = 0, payloads = 0;
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText(parsed) === 'application' && node.expression.name.text === 'evaluate') {
      calls++;
      const callback = node.arguments[0];
      assert.ok(ts.isArrowFunction(callback) || ts.isFunctionExpression(callback));
      if (node.arguments.length > 1) { payloads++; assert.equal(callback.parameters.length, 2, node.getText(parsed)); }
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.equal(calls, 8); assert.equal(payloads, 2);
});

test('the actual close helper executes the two-argument Electron callback and requires its matching successful receipt', async () => {
  const declaration = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'clickClosesWindow');
  assert.ok(declaration);
  const helper = Function('assert', 'until', `${declaration.getText(parsed)}; return clickClosesWindow;`)(assert, async (check: () => Promise<boolean>) => { assert.equal(await check(), true, 'Expected successful trusted dispatch'); });
  assert.equal(typeof helper, 'function');
  type Receipt = { channel: string; senderId: number; mainFrame: boolean };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'inspectorSecureDispatches');
  const electron = Object.freeze({ app: Object.freeze({}), BrowserWindow: Object.freeze({}) });
  const expected = { channel: 'lorca:secure-settings-submit', senderId: 42, mainFrame: true };
  const targetClosed = new Error('locator.click: Target page, context or browser has been closed\nCall log: performing click action');
  async function run(records: Receipt[], clickError?: Error, closes = true, completed = true) {
    const receipts: Receipt[] = [], payloads: number[] = [];
    Object.defineProperty(globalThis, 'inspectorSecureDispatches', { value: receipts, configurable: true });
    let closed = false, verified = false;
    const application = {
      browserWindow: async () => ({ evaluate: async (callback: (window: { webContents: { id: number } }) => number) => callback({ webContents: { id: 42 } }), dispose: async () => {} }),
      evaluate: async (callback: (module: typeof electron, payload: number) => Receipt[], payload: number) => { payloads.push(payload); return callback(electron, payload); },
    };
    const page = { isClosed: () => closed, waitForEvent: async (name: string) => { assert.equal(name, 'close'); } };
    const button = { click: async () => { closed = closes; receipts.push(...records); if (clickError) throw clickError; } };
    const result = await helper(application, page, button, expected.channel, async () => { assert.equal(completed, true); verified = true; return 'applied'; });
    assert.equal(verified, true); assert.deepEqual(payloads, [42, 42, 42]); return result;
  }
  try {
    assert.equal(await run([expected]), 'applied');
    assert.equal(await run([expected], targetClosed), 'applied');
    await assert.rejects(run([], targetClosed), /Expected successful trusted dispatch/);
    for (const wrong of [{ ...expected, channel: 'lorca:secure-settings-cancel' }, { ...expected, senderId: 43 }, { ...expected, mainFrame: false }]) await assert.rejects(run([wrong], targetClosed));
    await assert.rejects(run([expected, expected], targetClosed));
    await assert.rejects(run([expected], targetClosed, false));
    await assert.rejects(run([expected], targetClosed, true, false));
    const timeout = new Error('locator.click: Timeout 15000ms exceeded');
    await assert.rejects(run([expected], timeout), error => error === timeout);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'inspectorSecureDispatches', descriptor);
    else Reflect.deleteProperty(globalThis, 'inspectorSecureDispatches');
  }
});
