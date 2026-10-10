import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown, safeMarkdownUrl } from "./markdown";
import { TranscriptItem } from "./Transcript";
import { DotsMark } from "./DotsMark";
import { Avatar, ConversationAvatars, safeAvatarImage } from "./Avatar";
import { LorcaShell } from "./LorcaShell";
import { ConnectionStatusPopover, ConnectionStatusSummary } from "./ConnectionStatusPopover";
import { ComposerRunnerStatus } from "./ComposerRunnerStatus";
import { Settings, validateEndpoint } from "./Settings";
import { DevicesInventory, McpPanel } from "./settings/RuntimePanels";
import { BotSettingsPanel, ProvidersPanel } from "./settings/BotSettingsPanel";
import { DevicesPanel } from "./settings/DevicesPanel";
import { AutoReviewPanel as AutoReviewView } from "./settings/AutoReviewPanel";
import { useAutoReviewDraft } from "./settings/auto-review-draft";
import { CONTENT_WIDTH_STORAGE_KEY, readContentWidthPreference, writeContentWidthPreference } from "./content-width";
import {
  APPEARANCE_STORAGE_KEY,
  readAppearancePreference,
  writeAppearancePreference,
} from "./settings/appearance";
import type { LorcaShellActions, LorcaMessage, RuntimeSettings, LorcaShellState } from "./types";

const actions: LorcaShellActions = {
  onSelectConversation() {},
  onNewConversation() {},
  onSend() {},
  onStop() {},
  onSendNow() {},
  onLoadOlder() {},
  onSelectAgent() {},
  async onSaveEndpoint() {},
  onReconnect() {},
  onRefreshSettings() {},
  async onSettingsAction() { return { status: "cancelled" }; },
  onApproval() {},
};

function AutoReviewPanel(props: Parameters<typeof useAutoReviewDraft>[0]) {
  return <AutoReviewView draft={useAutoReviewDraft(props)} />;
}

function renderMessage(message: LorcaMessage) {
  return renderToStaticMarkup(
    <TranscriptItem message={message} actions={actions} disabled={false} />,
  );
}

test("Markdown never injects raw HTML, executes URLs, or loads remote images", () => {
  const html = renderToStaticMarkup(
    <Markdown
      text={
        "Hello <script>alert(1)</script>\n\n[unsafe](javascript:alert%281%29)\n\n![remote image](https://example.com/tracker.png)\n\n[safe reference](https://example.com)"
      }
    />,
  );
  assert.doesNotMatch(html, /<script|<img|href=|javascript:/i);
  assert.match(html, /remote image/);
  assert.match(html, /safe reference/);
  assert.match(html, /title="https:\/\/example.com\//);
});

test("Markdown formats fenced code as escaped text with a copy action", () => {
  const html = renderToStaticMarkup(
    <Markdown text={"```html\n<img src=x onerror=alert(1)>\n```"} />,
  );
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /aria-label="复制代码"/);
  assert.doesNotMatch(html, /<img/);
});

test("Unsafe or local file URL references are rejected", () => {
  for (const value of [
    "javascript:alert(1)",
    "data:text/html,test",
    "file:///etc/passwd",
    "//example.com",
    "/private/path",
    "lorca://admin",
  ]) {
    assert.equal(safeMarkdownUrl(value), undefined, value);
  }
  assert.equal(
    safeMarkdownUrl("https://example.com/docs"),
    "https://example.com/docs",
  );
});

test("Approval controls match capabilities without inventing persistent permission", () => {
  const base: Extract<LorcaMessage, { kind: "approval" }> = {
    kind: "approval",
    id: "a1",
    title: "Run a command",
    detail: "echo hello",
    status: "pending",
  };
  const normal = renderMessage(base);
  assert.match(normal, /仅允许一次/);
  assert.match(normal, />拒绝</);
  assert.doesNotMatch(normal, /始终允许/);
  const restricted = renderMessage({
    ...base,
    canAllow: false,
    canAlways: true,
  });
  assert.doesNotMatch(restricted, /仅允许一次|始终允许/);
  assert.match(restricted, />拒绝</);
  const persistent = renderMessage({ ...base, canAlways: true });
  assert.match(persistent, /始终允许此工具/);
  const expired = renderMessage({
    ...base,
    status: "expired",
    canAlways: true,
  });
  assert.match(expired, /已过期/);
  assert.doesNotMatch(expired, /仅允许一次|始终允许|>拒绝</);
});

test("Attachment-only messages show names as text without paths or navigation", () => {
  const html = renderMessage({
    kind: "message",
    id: "m1",
    role: "user",
    text: "",
    attachments: [
      {
        id: "opaque-1",
        name: "<report & notes>.pdf",
        mimeType: "application/pdf",
      },
    ],
  });
  assert.match(html, /&lt;report &amp; notes&gt;.pdf/);
  const attachment = html.match(/class="lorca-message-attachments">([\s\S]*?)<\/div>/)?.[1];
  assert.ok(attachment);
  assert.doesNotMatch(attachment, /href=|src=|opaque-1/);
});

test("Tool input and output are escaped, with distinct failure status", () => {
  const html = renderMessage({
    kind: "tool",
    id: "t1",
    name: "Read file",
    status: "error",
    input: "<script>bad</script>",
    output: "File not found",
  });
  assert.match(html, /失败/);
  assert.match(html, /File not found/);
  assert.match(html, /&lt;script&gt;bad&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test("Endpoint configuration allows loopback WebSockets only, without secrets", () => {
  for (const value of [
    "ws://127.0.0.1:9476/ws",
    "ws://localhost:9476/ws",
    "ws://localhost:00080/ws",
  ])
    assert.equal(validateEndpoint(value), null);
  for (const value of [
    "wss://[::1]:9476/ws",
    "ws://[::1]:9476/ws",
    "wss://localhost:9476/ws",
    "ws://localhost/ws",
    "ws://localhost:0/ws",
    "ws://localhost:65536/ws",
    "ws://127.1:9476/ws",
    "ws://LOCALHOST:9476/ws",
    "https://localhost:9476/ws",
    "ws://remote.example/ws",
    "ws://localhost/",
    "ws://localhost/ws?token=secret",
    "ws://user:secret@localhost/ws",
    "ws://localhost/ws#secret",
    "not a url",
  ])
    assert.notEqual(validateEndpoint(value), null, value);
});

test("Failed text messages preserve partial content and show their error", () => {
  for (const role of ["user", "assistant"] as const) {
    const html = renderMessage({
      kind: "message",
      id: "failed-1",
      role,
      text: "Partial response",
      error: "Runner disconnected",
    });
    assert.match(html, /Partial response/);
    assert.match(html, /role="alert"/);
    assert.match(html, /Runner disconnected/);
  }
});

test("Named assistant identities are preserved in headers and accessible labels", () => {
  const html = renderMessage({
    kind: "message",
    id: "named-1",
    role: "assistant",
    authorName: "Fixture Bot",
    text: "Named bot response",
  });
  assert.match(html, /aria-label="Fixture Bot 的回复"/);
  assert.match(html, /<span>Fixture Bot<\/span>/);
  assert.doesNotMatch(html, /<span>Lorca<\/span>/);
});

test("Renderer endpoint validation stays aligned with the native boundary", () => {
  const { validateEndpoint: validateNativeEndpoint } = createRequire(
    import.meta.url,
  )("../../native/bridge.cjs");
  const candidates = [
    "",
    " ws://localhost:4862/ws",
    "ws://localhost:4862/ws ",
    "ws://user:pass@localhost:4862/ws",
    "ws://localhost:4862/ws?token=test",
    "ws://localhost:4862/ws#hash",
  ];
  for (const scheme of ["ws", "wss", "http"]) {
    for (const host of [
      "localhost",
      "LOCALHOST",
      "127.0.0.1",
      "127.1",
      "[::1]",
      "remote.invalid",
    ]) {
      for (const port of [
        "",
        "0",
        "1",
        "80",
        "00080",
        "000080",
        "65535",
        "65536",
        "-1",
      ])
        candidates.push(`${scheme}://${host}:${port}/ws`);
    }
  }
  for (const value of candidates) {
    let nativeAccepted = true;
    try {
      validateNativeEndpoint(value);
    } catch {
      nativeAccepted = false;
    }
    assert.equal(validateEndpoint(value) === null, nativeAccepted, value);
  }
});

function runtimeFixture(): RuntimeSettings {
  return {
    version: "fixture-version",
    hasIdentity: true,
    relayConnected: false,
    updateRequired: false,
    authMode: "token",
    devices: [
      {
        id: "phone",
        name: "Paired phone",
        os: "ios",
        role: "device",
        version: "fixture-version",
        online: true,
        isThisDevice: true,
        plugins: [],
      },
      {
        id: "runner",
        name: "Known runner",
        os: "macos",
        role: "runner",
        version: "fixture-version",
        online: true,
        isThisDevice: false,
        plugins: [
          { id: "notes", name: "Notes", state: "ready", toolCount: null },
        ],
      },
    ],
    providers: [{ id: "provider", name: "Fixture provider", connected: true }],
    bots: [
      {
        id: "bot",
        name: "Fixture bot",
        runnerId: "runner",
        provider: "provider",
        model: null,
      },
    ],
    mcp: {
      status: "ready",
      runnerId: "runner",
      hasConfigError: false,
      servers: [
        {
          name: "Fixture MCP",
          transport: "stdio",
          enabled: true,
          state: "ready",
          toolCount: null,
          hiddenToolCount: null,
          hasError: false,
        },
      ],
    },
  };
}

test("Device inventory includes paired phones and preserves Runner details with unknown counts/models", () => {
  const html = renderToStaticMarkup(
    <DevicesInventory runtime={runtimeFixture()} />,
  );
  assert.match(html, /Known runner/);
  assert.match(html, /Paired phone/);
  assert.match(html, /设备 · 不运行智能体/);
  assert.match(html, /Runner · 使用账户的服务商凭据运行智能体/);
  assert.match(html, /1 个插件 · 1 个智能体/);
  assert.match(html, /未报告工具数量/);
  assert.match(html, /未报告模型/);
  assert.match(html, /Fixture provider/);
  assert.match(html, /Fixture bot/);
  assert.doesNotMatch(html, />0 个工具</);
});

test("Device inventory includes mobile devices and distinguishes Runner roles without exposing identifiers", () => {
  const runtime = runtimeFixture();
  runtime.devices[0].id = "private-device-identifier";
  runtime.devices.push({ id: "unreported-device", name: "Unreported platform", os: "unknown", version: "", online: false, isThisDevice: false, plugins: [] });
  const html = renderToStaticMarkup(<DevicesPanel runtime={runtime} />);
  assert.match(html, /Paired phone/);
  assert.match(html, /设备 · 不运行智能体/);
  assert.match(html, /Known runner/);
  assert.match(html, /Runner · 使用账户的服务商凭据运行智能体/);
  assert.match(html, /设备角色未报告/);
  assert.match(html, /当前设备/);
  assert.match(html, /在线状态，不会主动测试连接/);
  assert.doesNotMatch(html, /private-device-identifier|unreported-device/);
});

test("Pairing entry needs an explicit matching capability and a native callback", () => {
  for (const hasIdentity of [true, false]) {
    for (const capabilities of [undefined, { invite: false, join: false }, { invite: !hasIdentity, join: hasIdentity }, { invite: hasIdentity, join: !hasIdentity }]) {
      for (const callback of [false, true]) {
        let calls = 0;
        const runtime = { ...runtimeFixture(), hasIdentity, pairingCapabilities: capabilities };
        const html = renderToStaticMarkup(<DevicesPanel runtime={runtime} onOpenPairing={callback ? async () => { calls += 1; } : undefined} />);
        const available = Boolean(callback && capabilities?.[hasIdentity ? "invite" : "join"]);
        const label = hasIdentity ? "配对新设备" : "加入已有账号";
        const button = html.match(new RegExp(`<button[^>]*>${label}</button>`))?.[0];
        assert.ok(button);
        assert.equal(button.includes('disabled=""'), !available);
        assert.equal(html.includes("data-pairing-disabled-reason="), !available);
        assert.equal(calls, 0, "Reading or rendering settings never starts pairing");
        assert.doesNotMatch(html, /<input|<textarea|<img|已配对成功|配对已完成/);
      }
    }
  }
});

test("Pairing remains disabled during preview and stale or offline settings states", () => {
  const runtime = { ...runtimeFixture(), pairingCapabilities: { invite: true, join: true } };
  for (const props of [{ demo: true }, { disabled: true }]) {
    const html = renderToStaticMarkup(<DevicesPanel runtime={runtime} onOpenPairing={async () => { throw new Error("Rendering must not start pairing"); }} {...props} />);
    assert.match(html, /<button[^>]*disabled=""[^>]*>配对新设备<\/button>/);
    if ("demo" in props) assert.match(html, /模拟预览不生成配对码，也不会绑定设备/);
  }
  const empty = renderToStaticMarkup(<DevicesPanel onOpenPairing={async () => {}} />);
  assert.match(empty, /未报告任何设备/);
  assert.match(empty, /未报告/);
  assert.match(empty, /<button[^>]*disabled=""[^>]*>加入已有账号<\/button>/);
});

test("Pairing copy discloses account access and keeps local connection and Runner assignment separate", () => {
  const runtime = { ...runtimeFixture(), pairing_string: "synthetic-private-pairing-string", nonce: "synthetic-private-nonce" };
  const html = renderToStaticMarkup(<DevicesPanel runtime={runtime} />);
  assert.match(html, /账号访问权，包括聊天及服务商凭据/);
  assert.match(html, /生成或使用配对码前，需要在安全窗口中明确确认/);
  assert.match(html, /与 dots 到本地服务的连接认证不同/);
  assert.match(html, /不会更改智能体分配的 Runner/);
  assert.doesNotMatch(html, /synthetic-private/);
});

test("MCP inspection is read-only, excludes phones, and never invents hidden counts", () => {
  const runtime = runtimeFixture();
  runtime.mcp.runnerId = null;
  const html = renderToStaticMarkup(
    <McpPanel runtime={runtime} loading={false} onRefresh={() => {}} />,
  );
  assert.match(html, /“Known runner”报告的插件状态/);
  assert.doesNotMatch(html, /lorca-inspect-runner/);
  assert.doesNotMatch(html, /Paired phone|value="phone"|>0 个已隐藏</);
  assert.match(html, /MCP 配置仅作用于这个 Runner/);
  assert.doesNotMatch(html, /type="checkbox"|保存服务器|添加服务器|移除服务器/);
});

test("Unreported device roles are not inferred from OS in inventory or Runner selectors", () => {
  const runtime = runtimeFixture();
  delete runtime.devices[1].role;
  const inventory = renderToStaticMarkup(<DevicesInventory runtime={runtime} />);
  assert.match(inventory, /Known runner/);
  assert.match(inventory, /设备角色未报告/);
  assert.doesNotMatch(inventory, /Runner · 使用账户的服务商凭据运行智能体/);
  const mcp = renderToStaticMarkup(<McpPanel runtime={runtime} loading={false} onRefresh={() => {}} />);
  assert.doesNotMatch(mcp, /<option[^>]*value="runner"/);
  const editable = editableRuntime();
  delete editable.devices[1].role;
  const bot = renderToStaticMarkup(<BotSettingsPanel runtime={editable} disabled={false} onAction={actions.onSettingsAction} />);
  assert.match(bot, /<option value="runner" disabled="" selected=""/);
});

test("MCP status is explicitly reported configuration with unknown counts intact", () => {
  const html = renderToStaticMarkup(
    <McpPanel
      runtime={runtimeFixture()}
      loading={false}
      onRefresh={() => {}}
    />,
  );
  assert.match(html, /这些状态并非连接测试结果/);
  assert.match(html, /未报告工具数量/);
  assert.doesNotMatch(html, /0 个已隐藏|>0 个工具</);
});

test("Appearance storage restores known values and handles blocked or malformed storage", () => {
  assert.deepEqual(readAppearancePreference({ getItem: () => "dark" }), {
    theme: "dark",
    persistent: true,
  });
  assert.deepEqual(readAppearancePreference({ getItem: () => "not-a-theme" }), {
    theme: "light",
    persistent: true,
  });
  assert.deepEqual(
    readAppearancePreference({
      getItem: () => {
        throw new Error("blocked");
      },
    }),
    { theme: "light", persistent: false },
  );
  const writes: string[][] = [];
  assert.equal(
    writeAppearancePreference("dark", {
      setItem: (key, value) => {
        writes.push([key, value]);
      },
    }),
    true,
  );
  assert.deepEqual(writes, [[APPEARANCE_STORAGE_KEY, "dark"]]);
  assert.equal(
    writeAppearancePreference("light", {
      setItem: () => {
        throw new Error("blocked");
      },
    }),
    false,
  );
});

test("Content width defaults to adaptive wide and safely restores a local reading preference", () => {
  for (const value of [null, "wide", "unknown", "760px", "<script>"]) {
    assert.equal(readContentWidthPreference({ getItem: () => value }), "wide");
  }
  assert.equal(readContentWidthPreference({ getItem: () => "reading" }), "reading");
  assert.equal(readContentWidthPreference({ getItem: () => { throw new Error("blocked"); } }), "wide");
  const writes: string[][] = [];
  assert.equal(writeContentWidthPreference("reading", { setItem: (key, value) => { writes.push([key, value]); } }), true);
  assert.deepEqual(writes, [[CONTENT_WIDTH_STORAGE_KEY, "reading"]]);
  assert.equal(writeContentWidthPreference("wide", { setItem: () => { throw new Error("blocked"); } }), false);
});

test("Chat exposes an accessible local width switch without changing backend or settings capabilities", () => {
  const state: LorcaShellState = {
    connection: { status: "disconnected", endpoint: "ws://127.0.0.1:4862/ws" },
    conversations: [], activeConversationId: null, messages: [], agents: [], selectedAgentId: null,
    busy: false, loading: false, hasMore: false, loadingOlder: false, error: null, queue: [], demo: false,
  };
  const html = renderToStaticMarkup(<LorcaShell state={state} actions={actions} />);
  assert.match(html, /class="lorca-app" data-content-width="wide"/);
  const controls = html.match(/class="lorca-content-width"[\s\S]*?<\/div>/)?.[0];
  assert.ok(controls);
  assert.match(controls, /role="group" aria-label="内容宽度"/);
  assert.match(controls, /aria-pressed="true"[^>]*>宽屏<\/button>/);
  assert.match(controls, /aria-pressed="false"[^>]*>阅读<\/button>/);
  assert.doesNotMatch(controls, / disabled=|保存|连接/);
  assert.match(html, /data-app-mark="ghost"/);
});

test("Preferences expose appearance only and disclose its session scope", () => {
  const html = renderToStaticMarkup(
    <Settings
      open
      onOpenChange={() => {}}
      page="preferences"
      onPageChange={() => {}}
      connection={{ status: "connected", endpoint: "ws://127.0.0.1:4862/ws" }}
      demo
      actions={actions}
      theme="light"
      onThemeChange={() => {}}
      themePersistent
      runtime={runtimeFixture()}
    />,
  );
  assert.match(html, /仅适用于本次应用会话/);
  assert.match(html, /颜色主题/);
  assert.doesNotMatch(
    html,
    /type="checkbox"|API 密钥|密码|保存连接地址|始终批准/,
  );
});

test("Chinese transcript labels never translate code, tool payloads, or bot names", () => {
  const html = renderMessage({
    kind: "tool",
    id: "tool",
    name: "filesystem.read",
    status: "complete",
    input: '{"path":"README.md"}',
    output: "Original output 原文",
  });
  assert.match(html, /已完成/);
  assert.match(html, /filesystem.read/);
  assert.match(html, /README.md/);
  assert.match(html, /Original output 原文/);
  assert.match(html, /输入/);
  assert.match(html, /结果/);
  const code = renderToStaticMarkup(
    <Markdown text={"```sh\nprintf 'Original text'\n```"} />,
  );
  assert.match(code, /aria-label="复制代码"/);
  assert.match(code, /printf/);
  assert.match(code, /Original text/);
});

test("dots branding and Chinese chrome preserve original conversation and bot names", () => {
  const html = renderToStaticMarkup(
    <LorcaShell
      state={{
        connection: { status: "connected", endpoint: "ws://127.0.0.1:4862/ws" },
        conversations: [
          {
            id: "chat",
            title: "Lorca 原始对话",
            updatedAt: "2020-01-01T00:00:00Z",
            status: "waiting",
          },
        ],
        activeConversationId: null,
        messages: [],
        agents: [{ id: "original-bot-id", label: "BB Bot 名称" }],
        selectedAgentId: "original-bot-id",
        busy: false,
        loading: false,
        hasMore: false,
        loadingOlder: false,
        error: null,
        queue: [],
        demo: false,
      }}
      actions={actions}
    />,
  );
  assert.match(html, /想和 dots 聊些什么？/);
  assert.match(html, /开始聊天/);
  assert.match(html, /已有私聊会继续使用原对话/);
  assert.match(html, /aria-label="搜索智能体与对话"/);
  assert.match(html, /aria-label="发送消息"/);
  assert.match(html, /给 dots 发消息/);
  assert.match(html, /aria-label="等待授权"/);
  assert.match(html, /Lorca 原始对话/);
  assert.match(html, /BB Bot 名称/);
  assert.match(html, /data-selected-agent="original-bot-id"/);
  assert.match(html, /data-app-mark="ghost" src="\.\/app-icon\/64\.png"/);
  assert.match(html, /data-app-mark="ghost" src="\.\/app-icon\/128\.png"/);
  assert.doesNotMatch(html, /dots\.svg|<circle cx="10" cy="10" r="3.5"/);
  assert.doesNotMatch(html, /bb-logo|BB 界面|Lorca 工作区|给 Lorca 发消息/);
  const fallback = renderMessage({
    kind: "message",
    id: "fallback",
    role: "assistant",
    text: "Original response",
  });
  assert.match(fallback, /aria-label="dots 的回复"/);
  assert.match(fallback, /<span>dots<\/span>/);
});


function editableRuntime(): RuntimeSettings {
  const runtime = runtimeFixture();
  runtime.editor = {
    revision: "fixture-revision",
    models: [{ provider: "provider", id: "model", name: "Original model", levels: ["low", "high"] }],
    bots: [{ id: "bot", thinking: null }],
    providers: [{ id: "provider", canConfigure: true, canDisconnect: true }],
    canUpdateBots: true,
    canAddProvider: true,
    canManageMcp: true,
    autoReview: { status: "ready", isEnabled: false, rules: [{ id: "rule", text: "Original rule", behavior: "ask", tool: "filesystem/read" }] },
  };
  return runtime;
}

test("Editable bot settings disclose bot-wide scope and keep credentials in native dialogs", () => {
  const html = renderToStaticMarkup(<BotSettingsPanel runtime={editableRuntime()} disabled={false} onAction={actions.onSettingsAction} />);
  assert.match(html, /影响所有使用该智能体的对话/);
  assert.match(html, /不会迁移正在运行的任务、记忆或 MCP 配置/);
  assert.match(html, /Original model/);
  assert.match(html, /分配执行器/);
  assert.doesNotMatch(html, /新增服务商|断开连接/);
  assert.doesNotMatch(html, /type="password"|textarea|Paired phone/);
  const providers = renderToStaticMarkup(<ProvidersPanel runtime={editableRuntime()} disabled={false} onAction={actions.onSettingsAction} />);
  assert.match(providers, /独立的安全窗口/);
  assert.match(providers, /服务商凭据属于账号，会在已配对设备之间加密同步/);
  assert.match(providers, /新增服务商/);
  assert.doesNotMatch(providers, /lorca-edit-bot|lorca-bot-runner|type="password"|textarea/);
});

test("Settings navigation follows seven official groups and shares a read-only device selector", () => {
  const html = renderToStaticMarkup(<Settings open onOpenChange={() => {}} page="preferences" onPageChange={() => {}} connection={{ status: "connected", endpoint: "ws://127.0.0.1:4862/ws" }} demo={false} actions={actions} theme="light" onThemeChange={() => {}} themePersistent runtime={runtimeFixture()} />);
  const navigation = html.match(/<nav[\s\S]*?<\/nav>/)?.[0];
  assert.ok(navigation);
  const labels = ["通用", "服务商", "自动审查", "插件", "智能体", "设备", "高级"];
  let previous = -1;
  for (const label of labels) {
    const position = navigation.indexOf(`<span>${label}</span>`);
    assert.ok(position > previous, label);
    previous = position;
  }
  assert.doesNotMatch(navigation, />执行器<|>Runner（执行器）<|>模型与智能体</);
  assert.match(html, /<select aria-label="查看设备"/);
  assert.match(html, /仅切换查看范围，不会迁移智能体/);
  assert.match(html, /value="phone" selected=""/);
});

test("A viewed phone never exposes bot assignments or MCP mutation controls", () => {
  const runtime = editableRuntime();
  for (const page of ["models", "mcp"] as const) {
    const html = renderToStaticMarkup(<Settings open onOpenChange={() => {}} page={page} onPageChange={() => {}} connection={{ status: "connected", endpoint: "ws://127.0.0.1:4862/ws" }} demo={false} actions={actions} theme="light" onThemeChange={() => {}} themePersistent runtime={runtime} />);
    assert.match(html, /此设备不运行智能体/);
    assert.match(html, /请选择 Runner/);
    assert.doesNotMatch(html, /lorca-edit-bot|lorca-bot-runner|添加服务器|重新加载配置|Fixture MCP/);
  }
  const providers = renderToStaticMarkup(<Settings open onOpenChange={() => {}} page="providers" onPageChange={() => {}} connection={{ status: "connected", endpoint: "ws://127.0.0.1:4862/ws" }} demo={false} actions={actions} theme="light" onThemeChange={() => {}} themePersistent runtime={runtime} />);
  assert.match(providers, /此页设置属于整个账号，不受查看设备选择影响/);
  assert.match(providers, /新增服务商/);
});

test("Bot and device details are filtered by viewing scope without selecting another Runner for a bot", () => {
  const runtime = editableRuntime();
  const bot = renderToStaticMarkup(<BotSettingsPanel runtime={runtime} disabled={false} onAction={actions.onSettingsAction} deviceId="empty-runner" />);
  assert.match(bot, /此 Runner 上没有智能体/);
  assert.doesNotMatch(bot, /Fixture bot|lorca-bot-runner/);
  const devices = renderToStaticMarkup(<DevicesInventory runtime={runtime} selectedDeviceId="phone" onSelectDevice={() => {}} />);
  assert.match(devices, /Paired phone/);
  assert.match(devices, /Known runner/);
  assert.doesNotMatch(devices, /lorca-runtime-disclosure/);
});

test("Missing editor capabilities never create writable model or provider controls", () => {
  const html = renderToStaticMarkup(<BotSettingsPanel runtime={runtimeFixture()} disabled={false} onAction={actions.onSettingsAction} />);
  assert.match(html, /未提供此编辑能力/);
  assert.doesNotMatch(html, />应用更改<\/button>|>新增服务商…<\/button>|>断开连接<\/button>/);
});

test("MCP management exposes scoped actions without raw configuration fields", () => {
  const html = renderToStaticMarkup(<McpPanel runtime={editableRuntime()} loading={false} onRefresh={() => {}} onAction={actions.onSettingsAction} />);
  assert.match(html, /添加服务器/);
  assert.match(html, /重新连接/);
  assert.match(html, /移除/);
  assert.match(html, /独立安全窗口/);
  assert.doesNotMatch(html, /textarea|type="password"|Authorization|clientSecret/);
  const runtime = editableRuntime();
  runtime.mcp.runnerId = null;
  const stale = renderToStaticMarkup(<McpPanel runtime={runtime} loading={false} onRefresh={() => {}} onAction={actions.onSettingsAction} />);
  assert.doesNotMatch(stale, /添加服务器|>移除</);
});

test("Auto-review starts strict and preserves exact ask and allow wire values", () => {
  const html = renderToStaticMarkup(<AutoReviewPanel editor={editableRuntime().editor} disabled={false} onAction={actions.onSettingsAction} />);
  assert.match(html, /aria-checked="false"/);
  assert.match(html, /需审批的操作会请求确认；只读工具不受影响/);
  assert.match(html, /value="ask" selected=""/);
  assert.match(html, /value="allow"/);
  assert.match(html, /Original rule/);
  assert.match(html, /filesystem\/read/);
  assert.match(html, /查看变更/);
  assert.doesNotMatch(html, /value="deny"|value="always"/);
});

test("Exact tool rules label text as notes and disclose unconditional allow scope", () => {
  const editor = editableRuntime().editor;
  assert.ok(editor);
  editor.autoReview.rules[0] = { id: "existing", text: "Only if recipient is trusted", behavior: "allow", tool: "messages/send_external_message" };
  const html = renderToStaticMarkup(<AutoReviewPanel editor={editor} disabled={false} onAction={actions.onSettingsAction} />);
  assert.match(html, /规则 1 · 备注/);
  assert.match(html, /始终允许此工具/);
  assert.match(html, /精确工具：messages\/send_external_message。启用自动审查后，将始终允许此工具；备注不构成限制条件。/);
  assert.match(html, /value="Only if recipient is trusted"/);
  assert.doesNotMatch(html, /<option value="allow" selected="">符合规则时允许/);
  editor.autoReview.rules[0].tool = null;
  const textOnly = renderToStaticMarkup(<AutoReviewPanel editor={editor} disabled={false} onAction={actions.onSettingsAction} />);
  assert.match(textOnly, /适用情景/);
  assert.match(textOnly, /<option value="allow" selected="">符合规则时允许/);
  assert.match(textOnly, /未指定精确工具：适用情景交给模型判断。/);
});

test("Duplicate exact tool rules are disclosed and never silently collapsed", () => {
  const editor = editableRuntime().editor;
  assert.ok(editor);
  editor.autoReview.rules = [
    { id: "first", text: "Original allow note", behavior: "allow", tool: "messages/send" },
    { id: "second", text: "Original ask note", behavior: "ask", tool: "messages/send" },
  ];
  const html = renderToStaticMarkup(<AutoReviewPanel editor={editor} disabled={false} onAction={actions.onSettingsAction} />);
  assert.match(html, /以下精确工具重复：messages\/send/);
  assert.match(html, /后端按首条匹配处理，不保证“始终询问”优先/);
  assert.match(html, /Original allow note/);
  assert.match(html, /Original ask note/);
  assert.equal((html.match(/value="messages\/send"/g) ?? []).length, 2);
  assert.match(html, /disabled=""[^>]*>查看变更<\/button>/);
});

test("Unsupported or unreported auto-review state has no mutation controls", () => {
  const editor = editableRuntime().editor;
  assert.ok(editor);
  for (const state of [undefined, { ...editor, autoReview: { ...editor.autoReview, status: "unavailable" as const } }, { ...editor, autoReview: { ...editor.autoReview, isEnabled: null } }]) {
    const html = renderToStaticMarkup(<AutoReviewPanel editor={state} disabled={false} onAction={actions.onSettingsAction} />);
    assert.doesNotMatch(html, /role="switch"|添加规则|确认并提交/);
  }
});


test("Connection copy separates local authentication, device identity and service sign-in", () => {
  for (const authMode of ["token", "legacy"] as const) {
    const runtime = runtimeFixture();
    runtime.authMode = authMode;
    const html = renderToStaticMarkup(<Settings open onOpenChange={() => {}} page="connection" onPageChange={() => {}} connection={{ status: "connected", endpoint: "ws://127.0.0.1:4862/ws" }} demo={false} actions={actions} theme="light" onThemeChange={() => {}} themePersistent runtime={runtime} />);
    assert.match(html, /本地连接认证/);
    assert.match(html, /后端设备身份/);
    assert.match(html, /设备身份与中继通信由后端独立管理/);
    assert.match(html, /可选登录属于各自服务的授权，不替代前两者/);
    assert.match(html, authMode === "token" ? /本地令牌认证/ : /本地兼容连接（不校验令牌）/);
  }
});


test("Avatar rendering accepts only bounded PNG data and maps symbols and accents safely", () => {
  const image = "data:image/png;base64,iVBORw0KGgo=";
  const appearance = { botId: "synthetic-bot", name: "Original Bot", symbolName: "terminal.fill", accent: "green", image };
  const html = renderToStaticMarkup(<Avatar appearance={appearance} />);
  assert.match(html, /<img[^>]+data-avatar-image/);
  assert.match(html, /data-avatar-bot="synthetic-bot"/);
  assert.match(html, /data-accent="green"/);
  assert.equal(safeAvatarImage(image), image);
  for (const unsafe of ["https://example.com/avatar.png", "file:///private/avatar.png", "data:image/svg+xml;base64,AAAA", "data:image/png;base64,not base64", `data:image/png;base64,${"A".repeat(1024 * 1024)}`]) {
    assert.equal(safeAvatarImage(unsafe), undefined);
    const fallback = renderToStaticMarkup(<Avatar appearance={{ ...appearance, image: unsafe, accent: "red;background:url(https://example.com)", symbolName: "https://example.com/icon.svg" }} />);
    assert.doesNotMatch(fallback, /<img|example.com|style=/);
    assert.match(fallback, /data-accent="indigo"/);
    assert.match(fallback, /<svg/);
  }
  for (const symbolName of ["constructor", "__proto__", "toString"]) {
    const fallback = renderToStaticMarkup(<Avatar appearance={{ ...appearance, image: undefined, symbolName }} />);
    assert.doesNotMatch(fallback, /data-icon=|<img/);
    assert.match(fallback, /<svg/);
  }
  const person = renderToStaticMarkup(<Avatar person appearance={appearance} />);
  assert.match(person, /lorca-avatar-person/);
  assert.match(person, /data-user-avatar="ghost"/);
  assert.match(person, /src="\.\/app-icon\/64\.png"/);
  assert.doesNotMatch(person, /data-avatar-image|data-avatar-bot|data:image\/png/);
});

test("Conversation avatars use at most two ordered bot identities", () => {
  const avatars = ["first", "second", "third"].map((botId) => ({ botId, name: botId, symbolName: "terminal.fill", accent: "teal" }));
  const html = renderToStaticMarkup(<ConversationAvatars avatars={avatars} />);
  assert.match(html, /lorca-avatar-stack/);
  assert.ok(html.indexOf('data-avatar-bot="first"') < html.indexOf('data-avatar-bot="second"'));
  assert.doesNotMatch(html, /data-avatar-bot="third"/);
});

test("Default and configured symbols use the fallback surface while custom images remain separate", () => {
  const appearance = { botId: "synthetic-pink-bot", name: "Original Pink Bot", symbolName: "terminal.fill", accent: "pink" };
  const plain = renderToStaticMarkup(<Avatar />);
  assert.match(plain, /data-avatar-fallback/);
  assert.match(plain, /<svg/);
  assert.doesNotMatch(plain, /<img|style=/);
  const configured = renderToStaticMarkup(<Avatar appearance={appearance} />);
  assert.match(configured, /data-accent="pink"/);
  assert.match(configured, /data-avatar-fallback/);
  assert.match(configured, /data-icon="ComputerTerminal01"/);
  const image = "data:image/png;base64,iVBORw0KGgo=";
  const custom = renderToStaticMarkup(<Avatar appearance={{ ...appearance, image }} />);
  assert.match(custom, /src="data:image\/png;base64,iVBORw0KGgo="/);
  assert.doesNotMatch(custom, /data-avatar-fallback|style=|filter/);
  assert.equal(appearance.accent, "pink");
});

test("Message avatars preserve bot identity and use the bundled Ghost only for user messages", () => {
  const html = renderMessage({ kind: "message", id: "avatar", role: "assistant", authorName: "Named Bot", authorAvatar: { botId: "named-bot", name: "Named Bot", symbolName: "terminal.fill", accent: "green" }, text: "Synthetic response" });
  assert.match(html, /data-avatar-bot="named-bot"/);
  assert.match(html, /data-icon="ComputerTerminal01"/);
  assert.match(html, /Named Bot/);
  assert.doesNotMatch(html, /data-app-mark="ghost"|<circle cx="10" cy="10" r="3.5"/);
  const user = renderMessage({ kind: "message", id: "user", role: "user", text: "Synthetic message" });
  assert.match(user, /lorca-avatar-person/);
  assert.match(user, /<img data-user-avatar="ghost" src="\.\/app-icon\/64\.png"/);
  assert.doesNotMatch(user, /data-avatar-image|data-app-mark|data-avatar-bot/);
});


test("Composer bot selector shows the selected avatar and retains accessible labels and disabled states", () => {
  const state: LorcaShellState = {
    connection: { status: "connected", endpoint: "ws://127.0.0.1:4862/ws" },
    conversations: [], activeConversationId: null, messages: [],
    agents: [{ id: "selected-bot", label: "Selected Bot", appearance: { botId: "selected-bot", name: "Selected Bot", symbolName: "terminal.fill", accent: "green", image: "data:image/png;base64,iVBORw0KGgo=" } }],
    selectedAgentId: "selected-bot", busy: false, loading: false,
    hasMore: false, loadingOlder: false, error: null, queue: [], demo: false,
  };
  const picker = (value: LorcaShellState) => {
    const html = renderToStaticMarkup(<LorcaShell state={value} actions={actions} />);
    const start = html.indexOf('data-selected-agent=');
    assert.notEqual(start, -1);
    return html.slice(start, html.indexOf("</button>", start) + 9);
  };
  const enabled = picker(state);
  assert.match(enabled, /data-avatar-bot="selected-bot"/);
  assert.match(enabled, /<img[^>]+data-avatar-image/);
  assert.match(enabled, /aria-label="选择智能体"/);
  assert.match(enabled, /data-selected-agent="selected-bot"/);
  assert.match(enabled, /Selected Bot/);
  assert.doesNotMatch(enabled, /data-icon="Bot"|disabled=""|<select/);
  assert.match(enabled, /aria-haspopup="dialog"/);
  for (const patch of [{ busy: true }, { loading: true }, { agents: [], selectedAgentId: null }]) {
    assert.match(picker({ ...state, ...patch }), /disabled=""/);
  }
  for (const activeConversationId of ["existing-dm", "existing-group"]) {
    const existing = renderToStaticMarkup(<LorcaShell state={{ ...state, activeConversationId }} actions={actions} />);
    assert.doesNotMatch(existing, /lorca-agent-picker|aria-label="选择智能体"/);
  }
  const noImage = picker({ ...state, agents: state.agents.map((agent) => ({ ...agent, appearance: agent.appearance && { ...agent.appearance, image: undefined } })) });
  assert.match(noImage, /data-icon="ComputerTerminal01"/);
  assert.doesNotMatch(noImage, /<img/);
});


test("Application marks use the unchanged Ghost PNG assets without SVG or color treatment", () => {
  for (const large of [false, true]) {
    const html = renderToStaticMarkup(<DotsMark large={large} />);
    const size = large ? 128 : 64;
    assert.ok(html.includes(`src="./app-icon/${size}.png"`));
    assert.ok(html.includes(`width="${size}" height="${size}"`));
    assert.match(html, /data-app-mark="ghost"/);
    assert.doesNotMatch(html, /<svg|<circle|filter=|style=/);
  }
});


test("Connection status trigger opens a read-only popover instead of entering settings", () => {
  let settingsOpened = 0;
  const html = renderToStaticMarkup(<ConnectionStatusPopover state={{ connection: { status: "connected", endpoint: "ws://127.0.0.1:4862/ws" }, demo: false }} onSettings={() => { settingsOpened += 1; }} />);
  assert.match(html, /aria-label="查看连接状态"/);
  assert.match(html, /aria-haspopup="dialog"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /已连接/);
  assert.doesNotMatch(html, /打开连接设置|lorca-connection-summary|ws:\/\//);
  assert.equal(settingsOpened, 0);
});

test("Connection summary exposes only safe current status and cached device summaries", () => {
  const runtime = runtimeFixture();
  runtime.devices[0].name = "<script>Synthetic device</script>";
  const state = { connection: { status: "connected" as const, endpoint: "ws://private-endpoint.invalid/ws", detail: "private diagnostic detail" }, demo: false, runtimeSettings: runtime };
  const html = renderToStaticMarkup(<ConnectionStatusSummary state={state} />);
  assert.match(html, /&lt;script&gt;Synthetic device&lt;\/script&gt;/);
  assert.match(html, /2 \/ 2 台在线/);
  assert.match(html, /设备与中继信息来自最近一次读取/);
  assert.doesNotMatch(html, /private-endpoint|private diagnostic|Fixture provider|fixture-version|id="phone"|<script>|<button/);
  for (const connectionStatus of ["disconnected", "connecting", "error"] as const) {
    const stale = renderToStaticMarkup(<ConnectionStatusSummary state={{ ...state, connection: { ...state.connection, status: connectionStatus } }} />);
    assert.doesNotMatch(stale, /Synthetic device|台在线|最近一次读取/);
  }
  for (const patch of [{ runtimeSettings: undefined }, { settingsLoading: true }]) {
    const unavailable = renderToStaticMarkup(<ConnectionStatusSummary state={{ ...state, ...patch }} />);
    assert.match(unavailable, /尚未读取设备状态/);
    assert.doesNotMatch(unavailable, /Synthetic device|台在线/);
  }
  const demo = renderToStaticMarkup(<ConnectionStatusSummary state={{ ...state, demo: true }} />);
  assert.match(demo, /未连接真实智能体或后端/);
  assert.doesNotMatch(demo, /Synthetic device|台在线/);
});


test("Runner status renders only the supplied conversation summary without guessing the device", () => {
  for (const online of [true, false]) {
    const html = renderToStaticMarkup(<ComposerRunnerStatus summary={{ kind: "single", device: { id: "private-device-id", name: "<b>Named runner</b>", online } }} />);
    assert.match(html, /data-runner-kind="single"/);
    assert.match(html, /&lt;b&gt;Named runner&lt;\/b&gt;/);
    assert.match(html, online ? /data-online="true">在线/ : /data-online="false">离线/);
    assert.match(html, /后端最近报告状态/);
    assert.doesNotMatch(html, /private-device-id|<b>|本机|<button/);
  }
  for (const [kind, label] of [["multiple", "多个运行设备"], ["unknown", "运行设备未确认"], ["unassigned", "未分配"]] as const) {
    const html = renderToStaticMarkup(<ComposerRunnerStatus summary={{ kind }} />);
    assert.ok(html.includes(label));
    assert.doesNotMatch(html, /data-online=|在线|本机/);
  }
  assert.match(renderToStaticMarkup(<ComposerRunnerStatus summary={undefined} />), /运行设备未确认/);
});

test("Existing chat composer has one control row and keeps keyboard guidance accessible", () => {
  const state: LorcaShellState = {
    connection: { status: "connected", endpoint: "ws://127.0.0.1:4862/ws" },
    conversations: [], activeConversationId: "group", messages: [],
    agents: [{ id: "first-bot", label: "Must not be shown as the group recipient" }], selectedAgentId: "first-bot",
    busy: true, loading: false, hasMore: false, loadingOlder: false, error: null, queue: [], demo: false,
    runnerSummary: { kind: "multiple" }, attachmentsEnabled: true,
  };
  const html = renderToStaticMarkup(<LorcaShell state={state} actions={{ ...actions, onPickAttachments() {} }} />);
  const composer = html.slice(html.indexOf('class="lorca-composer'));
  assert.doesNotMatch(composer, /lorca-agent-picker|Must not be shown as the group recipient|lorca-composer-footnote|由本地运行环境提供支持/);
  assert.match(html, /aria-label="添加附件"/);
  assert.match(html, /data-runner-kind="multiple"/);
  assert.match(html, /aria-label="停止回复"/);
  assert.match(html, /aria-label="加入发送队列"/);
  assert.match(html, /aria-describedby="lorca-composer-help"/);
  assert.match(html, /<p class="sr-only" id="lorca-composer-help">Enter 发送 · Shift \+ Enter 换行 处理期间/);
});
