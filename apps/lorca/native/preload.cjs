const { contextBridge, ipcRenderer, webUtils } = require('electron');
window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.dataset.lorcaPlatform = process.platform;
}, { once: true });
const invoke = async (channel, ...args) => {
  try { return await ipcRenderer.invoke(channel, ...args); }
  catch (error) {
    let message = typeof error?.message === 'string' ? error.message : '本地请求失败，请重试';
    const prefix = `Error invoking remote method '${channel}': `;
    if (message.startsWith(prefix)) message = message.slice(prefix.length);
    if (message.startsWith('Error: ')) message = message.slice(7);
    throw new Error(message);
  }
};
const subscribe = (channel, listener) => {
  if (typeof listener !== 'function') throw new TypeError('必须提供监听函数');
  const handler = (_event, value) => listener(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};
let attachmentScope = null;
let attachmentTicket = null;
let attachmentGeneration = 0;
let attachmentReady = Promise.resolve();
let importing = false;
const attachmentListeners = new Set();
const attachmentTextListeners = new Set();
const attachmentPreviews = new Map();
function listenTo(listeners, listener) {
  if (typeof listener !== 'function') throw new TypeError('必须提供监听函数');
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function notifyAttachments(value) {
  for (const listener of attachmentListeners) { try { listener(value); } catch {} }
}
function revokeAttachments(ids) {
  for (const id of ids) {
    const url = attachmentPreviews.get(id);
    if (url) URL.revokeObjectURL(url);
    attachmentPreviews.delete(id);
  }
}
async function setAttachmentScope(scope) {
  if (scope !== null && (typeof scope !== 'string' || scope.length < 1 || scope.length > 512 || /[\x00-\x1f\x7f]/.test(scope))) throw new Error('附件草稿标识无效');
  if (scope === attachmentScope && (scope === null || attachmentTicket)) { await attachmentReady; return; }
  attachmentScope = scope; attachmentTicket = null;
  const generation = ++attachmentGeneration;
  revokeAttachments([...attachmentPreviews.keys()]);
  attachmentReady = invoke('lorca:set-attachment-scope', scope).then(result => {
    if (generation !== attachmentGeneration) return;
    if (scope !== null) {
      if (!result || typeof result.ticket !== 'string' || !/^[0-9a-f]{64}$/.test(result.ticket)) throw new Error('附件草稿尚未就绪');
      attachmentTicket = result.ticket;
    }
  });
  await attachmentReady;
}
function publicAttachments(result) {
  if (!result || !Array.isArray(result.attachments) || result.attachments.length > 10 || !Number.isInteger(result.duplicates) || result.duplicates < 0 || result.duplicates > 10) throw new Error('附件响应不兼容');
  return result.attachments.map(file => {
    if (!file || typeof file.id !== 'string' || !/^[a-f0-9]{32}$/.test(file.id) || typeof file.name !== 'string' || file.name.length > 255 || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > 100 * 1024 * 1024 || typeof file.mime !== 'string' || file.mime.length > 128) throw new Error('附件响应不兼容');
    let previewUrl;
    if (['image/png', 'image/jpeg', 'image/webp'].includes(file.previewMime) && file.previewBytes instanceof Uint8Array && file.previewBytes.byteLength > 0 && file.previewBytes.byteLength <= 4 * 1024 * 1024) {
      previewUrl = URL.createObjectURL(new Blob([file.previewBytes], { type: file.previewMime }));
      attachmentPreviews.set(file.id, previewUrl);
    }
    return { id: file.id, name: file.name, size: file.size, mime: file.mime, ...(previewUrl ? { previewUrl } : {}) };
  });
}
async function releaseAttachments(ids) {
  if (!Array.isArray(ids) || ids.length > 50 || ids.some(id => typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id))) throw new Error('附件选择标识无效');
  revokeAttachments(ids);
  return invoke('lorca:release-attachments', ids);
}
async function pickAttachments() {
  const scope = attachmentScope, generation = attachmentGeneration;
  await attachmentReady;
  if (!scope || generation !== attachmentGeneration || !attachmentTicket) throw new Error('附件草稿尚未就绪');
  const result = await invoke('lorca:pick-attachments', scope, attachmentTicket);
  if (generation !== attachmentGeneration) { await releaseAttachments(result.attachments.map(file => file.id)); return []; }
  const attachments = publicAttachments(result);
  if (result.duplicates) notifyAttachments({ scope, attachments: [], duplicates: result.duplicates });
  return attachments;
}
async function sendAttachments(params) {
  const scope = attachmentScope, generation = attachmentGeneration;
  await attachmentReady;
  if (!scope || generation !== attachmentGeneration || !attachmentTicket) throw new Error('附件草稿尚未就绪');
  try { return await invoke('lorca:send-attachments', scope, attachmentTicket, params); }
  finally { if (Array.isArray(params?.selection_ids)) revokeAttachments(params.selection_ids); }
}
function composerAccepts(event) {
  const element = event.target instanceof Element ? event.target : null;
  const composer = element?.closest('[data-attachment-composer]');
  return Boolean(composer && composer.getAttribute('data-attachment-disabled') !== 'true' && !element.closest('[disabled],[aria-disabled="true"]'));
}
function captureFiles(event) {
  const transfer = event.type === 'paste' ? event.clipboardData : event.dataTransfer;
  if (!transfer || !transfer.files?.length) return null;
  const files = Array.from(transfer.files);
  if (files.length > 10) throw new Error('每次最多添加十个文件');
  let total = 0;
  return files.map(file => {
    if (!(file instanceof File) || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > 100 * 1024 * 1024) throw new Error('每个附件必须是普通文件，且不超过 100 MiB');
    total += file.size;
    if (total > 250 * 1024 * 1024) throw new Error('待发送附件总大小必须不超过 250 MiB');
    let filePath;
    try { filePath = webUtils.getPathForFile(file); } catch { throw new Error('无法读取拖放的文件，请使用文件选择器'); }
    return { file, descriptor: filePath ? { kind: 'path', path: filePath, name: file.name, size: file.size, mime: file.type, lastModified: file.lastModified } : { kind: 'bytes', name: file.name, size: file.size, mime: file.type } };
  });
}
async function importCaptured(scope, generation, ready, source, captured) {
  const current = () => scope === attachmentScope && generation === attachmentGeneration;
  if (importing) { notifyAttachments({ scope, attachments: [], duplicates: 0, error: '另一批附件正在添加，请稍候' }); return; }
  importing = true;
  try {
    await ready;
    if (!current() || !attachmentTicket) return;
    const files = [];
    for (const item of captured) {
      if (item.descriptor.kind === 'bytes') {
        let bytes;
        try { bytes = new Uint8Array(await Blob.prototype.arrayBuffer.call(item.file)); } catch { throw new Error('无法读取粘贴的附件，请重新添加'); }
        if (!current()) return;
        files.push({ ...item.descriptor, bytes });
      } else files.push(item.descriptor);
    }
    if (!current()) return;
    const result = await invoke('lorca:import-attachments', scope, attachmentTicket, { source, files });
    if (!current()) { await releaseAttachments(result.attachments.map(file => file.id)); return; }
    notifyAttachments({ scope, attachments: publicAttachments(result), duplicates: result.duplicates });
  } catch (error) {
    if (current()) notifyAttachments({ scope, attachments: [], duplicates: 0, error: error instanceof Error ? error.message : '无法添加附件，请重试' });
  } finally { importing = false; }
}
window.addEventListener('DOMContentLoaded', () => {
  window.addEventListener('dragover', event => {
    if (Array.from(event.dataTransfer?.types ?? []).includes('Files')) { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = attachmentScope && composerAccepts(event) ? 'copy' : 'none'; }
  }, true);
  for (const name of ['paste', 'drop']) window.addEventListener(name, event => {
    const transfer = name === 'paste' ? event.clipboardData : event.dataTransfer;
    const hasFiles = Boolean(transfer?.files?.length) || Array.from(transfer?.types ?? []).includes('Files');
    if (name === 'drop' && hasFiles) event.preventDefault();
    if (!event.isTrusted || !hasFiles || !attachmentScope || !composerAccepts(event)) return;
    event.preventDefault();
    const scope = attachmentScope, generation = attachmentGeneration, ready = attachmentReady;
    let captured, failure;
    try { captured = captureFiles(event); if (!captured?.length) throw new Error('不支持拖入文件夹，请选择普通文件'); }
    catch (error) { failure = error; }
    if (name === 'paste') {
      const text = transfer.getData('text/plain');
      if (typeof text === 'string' && text.length > 200_000) failure = new Error('混合粘贴的文字超过 200,000 字符，本次文字和附件均未添加；请缩短文字或分开粘贴');
      else if (typeof text === 'string' && text) for (const listener of attachmentTextListeners) { try { listener(text); } catch {} }
    }
    if (generation !== attachmentGeneration) return;
    if (failure) notifyAttachments({ scope, attachments: [], duplicates: 0, error: failure instanceof Error ? failure.message : '无法添加附件，请重试' });
    else void importCaptured(scope, generation, ready, name, captured);
  }, true);
  window.addEventListener('pagehide', () => { ++attachmentGeneration; attachmentScope = null; attachmentTicket = null; revokeAttachments([...attachmentPreviews.keys()]); }, { once: true });
}, { once: true });
contextBridge.exposeInMainWorld('lorca', Object.freeze({
  connect: endpoint => invoke('lorca:connect', endpoint),
  request: (method, params) => invoke('lorca:request', method, params),
  copyText: text => invoke('lorca:copy-text', text),
  getBotAvatar: (botId, expectedAvatarVersion) => invoke('lorca:bot-avatar', botId, expectedAvatarVersion),
  getStatus: () => invoke('lorca:status'),
  setWatchingChat: chatId => invoke('lorca:set-watching-chat', chatId),
  getSettings: (params = {}) => invoke('lorca:get-settings', params),
  openPairing: mode => invoke('lorca:open-pairing', mode),
  settingsAction: action => invoke('lorca:settings-action', action),
  onEvent: listener => subscribe('lorca:event', listener),
  onStatus: listener => subscribe('lorca:status-update', listener),
  setAttachmentScope,
  onAttachmentImport: listener => listenTo(attachmentListeners, listener),
  onAttachmentText: listener => listenTo(attachmentTextListeners, listener),
  pickAttachments,
  releaseAttachments,
  sendAttachments,
}));
