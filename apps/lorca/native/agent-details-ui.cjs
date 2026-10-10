const { validateAgentAction, MAX_MEMORY_BYTES } = require('./agent-details.cjs');
const { validateSecurePreview } = require('./secure-settings.cjs');

const INVALID = '智能体编辑窗口参数无效，请重新打开。';
const CHANGED = '智能体编辑窗口或连接已变化，请重新打开。';
const MEMORY_ERRORS = new Set(['记忆已变化，请重新读取并合并修改；未覆盖现有内容', '记忆正文不完整或超过 256 KiB，无法安全编辑', '智能体资料已变化或编辑已过期，请刷新后重新编辑', '智能体所属账号、连接或选择已变化，请重新打开详情']);
function object(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).some(key => !keys.includes(key))) throw new Error(INVALID);
  return value;
}
function text(value, maximum = 256) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\0\r\n]/.test(value)) throw new Error(INVALID);
  return value;
}
function visible(value) { return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, value => `\\u${value.charCodeAt(0).toString(16).padStart(4, '0')}`); }
function noFields(value) { if (Object.keys(object(value, [])).length) throw new Error(INVALID); return true; }

function createAgentDetailsUI({ secureSettings, dialog, getParent, getDetails }) {
  let memoryBusy = false;
  let confirmations = 0;
  let previews = 0;
  async function confirm(spec, guard) {
    object(spec, ['title', 'message', 'detail']);
    text(spec.title); text(spec.message, 4096);
    if (typeof spec.detail !== 'string' || spec.detail.length > 4_000_000) throw new Error(INVALID);
    const title = visible(spec.title), message = visible(spec.message), detail = spec.detail;
    ++confirmations;
    try {
      guard();
      const needsReview = detail.length > 2500;
      if (needsReview) {
        const reviewed = await secureSettings.edit({ title: '复核智能体变更', description: message, review: true, fields: [{ key: 'review', label: '完整变更范围', type: 'review', value: detail }] }, guard, noFields);
        guard();
        if (reviewed !== true) return false;
      }
      const parent = getParent();
      if (!parent || parent.isDestroyed()) throw new Error(CHANGED);
      guard();
      const result = await dialog.showMessageBox(parent, { type: 'warning', title, message, detail: needsReview ? '完整变更已在隔离窗口展示。将执行刚才复核的完整变更范围；结果未知时不会自动重发。' : detail, buttons: ['取消', '应用变更'], defaultId: 0, cancelId: 0, noLink: true });
      guard();
      return result.response === 1;
    } finally { --confirmations; }
  }
  async function reviewAvatar(spec, guard) {
    object(spec, ['title', 'botId', 'botName', 'previewDataUrl', 'width', 'height', 'size']);
    text(spec.title); text(spec.botId); text(spec.botName);
    const preview = validateSecurePreview({ dataUrl: spec.previewDataUrl, width: spec.width, height: spec.height, alt: '待保存的智能体头像' });
    const size = Buffer.from(preview.dataUrl.slice('data:image/png;base64,'.length), 'base64').length;
    if (spec.size !== size) throw new Error(INVALID);
    ++previews;
    try {
      guard();
      const result = await secureSettings.edit({ title: visible(spec.title), description: `为 ${visible(spec.botName)}（${visible(spec.botId)}）保存此头像？图片已在本机重新编码为 PNG，保存会影响所有使用该智能体的聊天，随后还需系统确认。`, submitLabel: '使用此头像', preview, fields: [] }, guard, noFields);
      guard();
      return result === true;
    } finally { --previews; }
  }
  async function openMemory(revision, trusted = () => {}) {
    text(revision);
    if (memoryBusy) throw new Error('已有记忆编辑窗口或保存操作正在进行。');
    memoryBusy = true;
    try {
      trusted();
      const details = getDetails();
      const loaded = await details.getMemory({ revision }, trusted);
      const guard = () => { trusted(); details.check(loaded.revision, trusted); };
      guard();
      const initial = validateAgentAction({ kind: 'memory.save', revision: loaded.revision, text: loaded.text, expectedHash: loaded.hash });
      const botId = text(loaded.botId), runnerId = text(loaded.runnerId);
      const normalized = initial.text.replace(/\r\n?/g, '\n');
      const action = await secureSettings.edit({ title: '编辑智能体记忆', description: `智能体：${visible(botId)}\n执行器：${visible(runnerId)}\n以下为完整 MEMORY.md 正文，最多 ${MAX_MEMORY_BYTES} 字节。保存会影响该智能体的所有聊天，不会迁移其他执行器的记忆。${loaded.truncated ? '\n当前内容已超出每轮自动加载预算，但此处仍显示完整正文。' : ''}`, submitLabel: '复核并保存', fields: [{ key: 'memory', label: '完整记忆正文', type: 'memory', value: initial.text }] }, guard, values => {
        object(values, ['memory']);
        return validateAgentAction({ kind: 'memory.save', revision: initial.revision, text: values.memory === normalized ? initial.text : values.memory, expectedHash: initial.expectedHash });
      });
      guard();
      if (action === null) return { status: 'cancelled', botId };
      const result = await details.apply(action, trusted);
      if (!result || !['applied', 'cancelled', 'unknownOutcome'].includes(result.status) || result.botId !== botId) return { status: 'unknownOutcome', botId };
      return { status: result.status, botId };
    } catch (error) {
      throw new Error(MEMORY_ERRORS.has(error?.message) ? error.message : '无法完成记忆编辑，请检查连接并重新打开详情。');
    } finally { memoryBusy = false; }
  }
  return { openMemory, reviewAvatar, confirm, isActive: () => memoryBusy || confirmations > 0 || previews > 0 };
}
module.exports = { createAgentDetailsUI };
