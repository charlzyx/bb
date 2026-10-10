function chatId(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200 || value.includes('\0')) throw new Error('可见会话标识无效');
  return value;
}

class WatchingChat {
  constructor(bridge) {
    this.bridge = bridge;
    this.generation = bridge.getStatus().generation;
    this.epoch = 0;
    this.revision = 0;
    this.identity = undefined;
    this.known = new Set();
    this.selected = null;
    this.foreground = false;
    this.applied = undefined;
    this.maybeWatching = false;
    this.blockedRevision = -1;
    this.running = false;
    this.dirty = false;
    this.disposed = false;
    this.statusListener = status => {
      if (status.status !== 'connected' || status.generation !== this.generation) {
        this.generation = status.generation;
        this.maybeWatching = false;
        this.reset();
      }
    };
    this.eventListener = event => { if (event.event === 'identity.changed') this.reset(); };
    bridge.on('status', this.statusListener);
    bridge.on('event', this.eventListener);
  }
  reset() {
    this.epoch++;
    this.identity = undefined;
    this.known.clear();
    this.selected = null;
    this.applied = undefined;
    this.changed();
  }
  observeSnapshot(snapshot) {
    if (this.disposed || this.bridge.getStatus().status !== 'connected') return;
    if (!snapshot || typeof snapshot.has_identity !== 'boolean' || (snapshot.identity_id != null && typeof snapshot.identity_id !== 'string')) { this.reset(); return; }
    const identity = `${snapshot.has_identity}:${snapshot.identity_id ?? ''}`;
    if (this.identity !== undefined && identity !== this.identity) this.reset();
    this.identity = snapshot.has_identity ? identity : undefined;
    this.observeChats(snapshot.chats);
  }
  observeChats(chats) {
    if (this.disposed || this.identity === undefined || this.bridge.getStatus().status !== 'connected') return;
    try {
      if (!Array.isArray(chats) || chats.length > 2048) throw new Error('会话列表无效');
      this.known = new Set(chats.map(chat => chatId(chat?.id)));
    } catch { this.reset(); return; }
    if (this.selected !== null && !this.known.has(this.selected)) { this.selected = null; this.changed(); }
  }
  observeCreated(chat) {
    if (this.identity === undefined || this.bridge.getStatus().status !== 'connected' || this.known.size >= 2048) return;
    this.known.add(chatId(chat?.id));
  }
  removeChat(id) {
    this.known.delete(id);
    if (this.selected === id) { this.selected = null; this.changed(); }
  }
  select(id) {
    if (this.disposed) { if (id === null) return; throw new Error('聊天窗口已关闭'); }
    if (id !== null && (!this.known.has(chatId(id)) || this.identity === undefined || this.bridge.getStatus().status !== 'connected')) throw new Error('会话尚未同步，请刷新后再查看');
    if (this.selected === id) return;
    this.selected = id;
    this.changed();
  }
  setForeground(value) {
    const foreground = value === true;
    if (this.foreground === foreground) return;
    this.foreground = foreground;
    this.changed();
  }
  target() {
    return this.foreground && this.identity !== undefined && this.known.has(this.selected) && this.blockedRevision !== this.revision ? this.selected : null;
  }
  changed() {
    this.revision++;
    this.dirty = true;
    this.schedule();
  }
  schedule() {
    if (this.running || this.disposed || this.bridge.getStatus().status !== 'connected') return;
    this.running = true;
    void this.flush().finally(() => {
      this.running = false;
      if (this.dirty) this.schedule();
    });
  }
  async flush() {
    while (!this.disposed && this.bridge.getStatus().status === 'connected') {
      this.dirty = false;
      const target = this.target();
      if (target === this.applied || (target === null && !this.maybeWatching)) return;
      const generation = this.bridge.getStatus().generation, epoch = this.epoch, revision = this.revision;
      const current = () => !this.disposed && this.bridge.getStatus().status === 'connected' && this.bridge.getStatus().generation === generation && this.epoch === epoch;
      if (target !== null) this.maybeWatching = true;
      try {
        const result = await this.bridge.sendValidated('ui.watching', { chat_id: target });
        if (result !== null) throw new Error('查看状态响应无效');
      } catch {
        if (!current()) continue;
        this.applied = undefined;
        if (target === null) return;
        this.blockedRevision = revision;
        continue;
      }
      if (!this.disposed && this.bridge.getStatus().status === 'connected' && this.bridge.getStatus().generation === generation) this.maybeWatching = target !== null;
      if (!current()) continue;
      this.applied = target;
      if (target !== null && target === this.target()) {
        try { void this.bridge.sendValidated('chats.mark_read', { chat_id: target }).catch(() => {}); } catch {}
      }
    }
  }
  dispose() {
    this.disposed = true;
    this.known.clear();
    this.selected = null;
    this.bridge.removeListener('status', this.statusListener);
    this.bridge.removeListener('event', this.eventListener);
  }
}

module.exports = { WatchingChat };
