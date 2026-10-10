export function installAttachmentFixture({ theme = "light" } = {}) {
  localStorage.setItem("bb-lorca.appearance", theme);
  const events = new Set();
  const statuses = new Set();
  const imports = new Set();
  const texts = new Set();
  const savedTexts = [];
  const requests = [];
  const scopes = [];
  const released = [];
  const previews = new Map();
  const attachments = new Map();
  const sends = [];
  let scope = null;
  let identity = "synthetic-attachment-account";
  let generation = 1;
  let serial = 0;
  let connection = "connected";
  const epoch = Math.floor(Date.now() / 1000);
  const chats = ["primary", "secondary"].map((id, index) => ({
    id: `attachment-${id}`, kind: "dm", title: index ? "合成附件 · 第二个聊天" : "合成附件 · 输入与预览", bot_ids: ["attachment-bot"], created_at: epoch - index, has_more: false,
    messages: [{ id: `attachment-${id}-intro`, chat_id: `attachment-${id}`, author: { kind: "bot", bot_id: "attachment-bot" }, body: { kind: "text", text: "这是合成附件交互测试。图片和文件元数据均在当前测试页生成，不读取剪贴板、磁盘文件或真实服务。\n\n检查选择区插入、连续粘贴通知、图片预览和草稿切换。测试通知只验证界面处理，真实粘贴来源由原生专项测试验证。" }, state: { kind: "complete" }, created_at: epoch - index }],
  }));
  const status = () => ({ status: connection, endpoint: "ws://127.0.0.1:4862/ws", generation, authMode: "token", detail: "仅用于合成附件交互测试" });
  const makeFile = (kind = "image", id = `synthetic-attachment-${++serial}`) => {
    if (attachments.has(id)) return structuredClone(attachments.get(id));
    const file = { id, name: kind === "file" ? "合成说明文件.txt" : kind === "broken" ? "合成预览解码失败.png" : "合成图片 · 很长的文件名用于检查省略号和完整提示.png", mime: kind === "file" ? "text/plain" : "image/png", size: kind === "file" ? 2048 : 1600 };
    if (kind !== "file") {
      let bytes;
      if (kind === "broken") bytes = new TextEncoder().encode("Synthetic invalid raster preview");
      else {
        const canvas = document.createElement("canvas");
        canvas.width = 160;
        canvas.height = 100;
        const context = canvas.getContext("2d");
        const gradient = context.createLinearGradient(0, 0, 160, 100);
        gradient.addColorStop(0, "#3d8baa");
        gradient.addColorStop(1, "#8d7aa1");
        context.fillStyle = gradient;
        context.fillRect(0, 0, 160, 100);
        context.fillStyle = "#f1eee7";
        context.beginPath();
        context.arc(112, 30, 13, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = "#355d67";
        context.beginPath();
        context.moveTo(0, 100);
        context.lineTo(48, 38);
        context.lineTo(95, 100);
        context.fill();
        bytes = Uint8Array.from(atob(canvas.toDataURL("image/png").split(",")[1]), (value) => value.charCodeAt(0));
      }
      file.size = bytes.length;
      file.previewUrl = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
      previews.set(id, file.previewUrl);
    }
    attachments.set(id, file);
    return structuredClone(file);
  };
  const emitImport = (files, options = {}) => {
    for (const listener of imports) listener({ scope: options.scope ?? scope, attachments: structuredClone(files), duplicates: options.duplicates ?? 0, ...(options.error ? { error: options.error } : {}) });
  };
  window.__attachmentUiTest = {
    snapshot: () => ({ scope, scopes: [...scopes], released: structuredClone(released), requests: structuredClone(requests), textListeners: texts.size, importListeners: imports.size, pendingSends: sends.length }),
    file: makeFile,
    emitImport,
    mixed(text, files = []) {
      for (const listener of texts) listener(text);
      emitImport(files);
    },
    captureTextListeners() { savedTexts.push([...texts]); return savedTexts.length - 1; },
    emitCapturedText(index, text) { for (const listener of savedTexts[index]) listener(text); },
    changeIdentity() {
      identity = "synthetic-attachment-account-two";
      for (const listener of events) listener({ event: "identity.changed", data: { has_identity: true } });
    },
    setConnection(value) {
      connection = value;
      if (value === "connected") generation++;
      for (const listener of statuses) listener(status());
    },
    completeSend() {
      const pending = sends.shift();
      if (!pending) throw new Error("No synthetic attachment send is pending");
      pending.resolve({ message: { id: pending.params.message_id, chat_id: pending.params.chat_id, author: { kind: "you" }, body: { kind: "text", text: pending.params.text }, state: { kind: "complete" }, created_at: epoch + 10 } });
    },
  };
  window.lorca = {
    getStatus: async () => status(),
    connect: async () => { throw new Error("Synthetic attachment fixtures cannot connect to services"); },
    request: async (method, params) => {
      requests.push({ method, params: structuredClone(params) });
      if (method === "bootstrap") return { version: "synthetic-attachments", identity_id: identity, has_identity: true, relay_connected: false, devices: [{ id: "attachment-runner", name: "合成附件 Runner", status: "online" }], bots: [{ id: "attachment-bot", name: "合成附件助手", runner_id: "attachment-runner" }], chats: structuredClone(chats), running_turns: [], running_chat_ids: [] };
      throw new Error(`Unexpected synthetic attachment request: ${method}`);
    },
    onEvent: (listener) => { events.add(listener); return () => events.delete(listener); },
    onStatus: (listener) => { statuses.add(listener); return () => statuses.delete(listener); },
    setAttachmentScope: async (value) => { scope = value; scopes.push(value); },
    onAttachmentImport: (listener) => { imports.add(listener); return () => imports.delete(listener); },
    onAttachmentText: (listener) => { texts.add(listener); return () => texts.delete(listener); },
    pickAttachments: async () => { requests.push({ method: "pickAttachments" }); return [makeFile("file", "synthetic-picker-file")]; },
    releaseAttachments: async (ids) => {
      released.push([...ids]);
      for (const id of ids) {
        const preview = previews.get(id);
        if (preview) URL.revokeObjectURL(preview);
        previews.delete(id);
      }
    },
    sendAttachments: async (params) => {
      requests.push({ method: "sendAttachments", params: structuredClone(params) });
      return new Promise((resolve) => sends.push({ params, resolve }));
    },
  };
}
