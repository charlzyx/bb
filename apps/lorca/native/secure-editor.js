const form = document.querySelector('#editor');
const fields = document.querySelector('#fields');
const error = document.querySelector('#error');
const submit = document.querySelector('#submit');
let inputs = [];
let pending = false;
function clear() { for (const input of inputs) input.element.value = ''; inputs = []; }
window.addEventListener('pagehide', clear);
document.querySelector('#cancel').addEventListener('click', () => { clear(); void window.dotsSecureSettings.cancel(); });
form.addEventListener('submit', async event => {
  event.preventDefault(); if (pending) return;
  pending = true; submit.disabled = true; error.textContent = '';
  try {
    const values = Object.fromEntries(inputs.filter(input => !input.readOnly).map(input => [input.key, input.element.value]));
    const result = await window.dotsSecureSettings.submit(values);
    if (result.ok) clear(); else error.textContent = result.error;
  } catch { error.textContent = '窗口或连接已变化，请关闭后重新打开。'; }
  finally { pending = false; submit.disabled = false; }
});
window.dotsSecureSettings.initialize().then(spec => {
  document.querySelector('#title').textContent = spec.title;
  document.querySelector('#description').textContent = spec.description;
  if (spec.review) submit.textContent = '已核对全部变更';
  for (const field of spec.fields) {
    const label = document.createElement('label');
    label.htmlFor = field.key; label.textContent = field.label;
    const element = document.createElement(field.type === 'select' ? 'select' : ['textarea', 'review'].includes(field.type) ? 'textarea' : 'input');
    element.id = field.key; element.name = field.key; element.autocomplete = 'off'; element.spellcheck = false;
    if (element.tagName === 'INPUT') element.type = field.type === 'password' ? 'password' : 'text';
    if (field.type === 'select') for (const value of field.options) { const option = document.createElement('option'); option.value = value; option.textContent = value === 'yes' ? '是' : value === 'no' ? '否' : value; element.append(option); }
    element.readOnly = field.type === 'review';
    element.value = field.value; element.maxLength = field.type === 'review' ? 500_000 : field.type === 'textarea' ? 100_000 : 16_000;
    fields.append(label, element); inputs.push({ key: field.key, element, readOnly: field.type === 'review' });
  }
  submit.disabled = false; inputs[0]?.element.focus();
}).catch(() => { error.textContent = '无法打开安全设置，请关闭后重新打开。'; });
