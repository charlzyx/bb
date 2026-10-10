const form = document.querySelector('#pairing');
const submit = document.querySelector('#submit');
const close = document.querySelector('#close');
const input = document.querySelector('#pairing-string');
const name = document.querySelector('#device-name');
const code = document.querySelector('#generated-code');
const error = document.querySelector('#error');
let state = null;
let pending = false;
function clear() { input.value = ''; name.value = ''; code.value = ''; }
function render(value) {
  state = value;
  document.querySelector('#title').textContent = value.mode === 'invite' ? '邀请新设备' : '加入已有账号';
  document.querySelector('#detail').textContent = value.detail;
  document.querySelector('#join-fields').hidden = value.mode !== 'join' || value.phase !== 'ready';
  document.querySelector('#invite-code').hidden = value.phase !== 'waiting';
  code.value = value.pairingString ?? '';
  document.querySelector('#remaining').textContent = value.remainingSeconds === null ? '' : `最多剩余 ${Math.ceil(value.remainingSeconds / 60)} 分钟`;
  document.querySelector('#device').textContent = value.device ? `设备：${value.device.name || '未命名设备'}（${value.device.os || '未知系统'}）\n标识：${value.device.id}` : '';
  submit.textContent = value.mode === 'invite' ? '生成配对码' : '加入账号';
  submit.hidden = !['ready', 'confirming'].includes(value.phase);
  submit.disabled = pending || value.phase !== 'ready';
  close.textContent = value.phase === 'waiting' ? '停止等待并关闭' : '关闭';
  if (value.phase !== 'ready') { input.value = ''; name.value = ''; }
}
const unsubscribe = window.dotsPairing.onState(render);
window.addEventListener('pagehide', () => { clear(); unsubscribe(); });
close.addEventListener('click', () => { clear(); void window.dotsPairing.close().catch(() => { error.textContent = '窗口已失效，请关闭后检查设备列表。'; }); });
form.addEventListener('submit', async event => {
  event.preventDefault(); if (pending || !state || state.phase !== 'ready') return;
  const values = state.mode === 'invite' ? {} : { pairingString: input.value, deviceName: name.value };
  pending = true; submit.disabled = true; error.textContent = '';
  try { const result = await window.dotsPairing.submit(values); if (!result.ok) error.textContent = result.error; }
  catch { error.textContent = '配对结果尚不确定，请检查设备列表。请求不会自动重发。'; }
  finally { clear(); pending = false; if (state) render(state); }
});
window.dotsPairing.initialize().then(render).catch(() => { clear(); error.textContent = '无法打开配对窗口，请检查本地令牌认证和连接状态。'; });
