import assert from "node:assert/strict";

export async function expectRestoredFocus(locator) {
  await locator.evaluate(element => new Promise((resolve, reject) => {
    let frame;
    const timeout = setTimeout(() => { cancelAnimationFrame(frame); reject(new Error("Expected focus restoration to the exact trigger within one second")); }, 1000);
    const check = () => {
      if (document.activeElement === element) { clearTimeout(timeout); resolve(); }
      else frame = requestAnimationFrame(check);
    };
    check();
  }));
  assert.equal(await locator.evaluate(element => document.activeElement === element), true);
}
