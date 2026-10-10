const form = document.querySelector('#editor');
const fields = document.querySelector('#fields');
const error = document.querySelector('#error');
const submit = document.querySelector('#submit');
let inputs = [];
let pending = false;
let preview = null;
function clear() { for (const input of inputs) input.element.value = ''; inputs = []; if (preview) { preview.removeAttribute('src'); preview.remove(); preview = null; } }
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
  if (spec.submitLabel) submit.textContent = spec.submitLabel;
  if (spec.review) submit.textContent = '已核对全部变更';
  if (spec.preview) {
    if (typeof spec.preview.dataUrl !== 'string' || spec.preview.dataUrl.length > 2_800_000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(spec.preview.dataUrl)) throw new Error('Invalid preview');
    preview = document.createElement('img'); preview.className = 'avatar-preview'; preview.alt = spec.preview.alt; preview.width = spec.preview.width; preview.height = spec.preview.height; preview.src = spec.preview.dataUrl;
    fields.append(preview);
  }
  for (const field of spec.fields) {
    const label = document.createElement('label');
    label.htmlFor = field.key; label.textContent = field.label;
    const element = document.createElement(field.type === 'select' ? 'select' : ['textarea', 'review', 'memory'].includes(field.type) ? 'textarea' : 'input');
    element.id = field.key; element.name = field.key; element.autocomplete = 'off'; element.spellcheck = false;
    if (element.tagName === 'INPUT') element.type = field.type === 'password' ? 'password' : 'text';
    if (field.type === 'select') for (const value of field.options) { const option = document.createElement('option'); option.value = value; option.textContent = value === 'yes' ? '是' : value === 'no' ? '否' : value; element.append(option); }
    element.readOnly = field.type === 'review';
    element.value = field.value;
    if (field.type !== 'review') element.maxLength = field.type === 'memory' ? 262_144 : field.type === 'textarea' ? 100_000 : 16_000;
    fields.append(label, element); inputs.push({ key: field.key, element, readOnly: field.type === 'review' });
  }
  submit.disabled = false; inputs[0]?.element.focus();
}).catch(() => { clear(); error.textContent = '无法打开安全设置，请关闭后重新打开。'; });
