import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown, safeMarkdownUrl } from "./markdown";
import { TranscriptItem } from "./Transcript";
import { Avatar, ConversationAvatars, safeAvatarImage } from "./Avatar";
import { LorcaShell } from "./LorcaShell";
import { Settings, validateEndpoint } from "./Settings";
import { McpPanel, RunnersPanel } from "./settings/RuntimePanels";
import { BotSettingsPanel } from "./settings/BotSettingsPanel";
import { AutoReviewPanel as AutoReviewView } from "./settings/AutoReviewPanel";
import { useAutoReviewDraft } from "./settings/auto-review-draft";
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
  assert.doesNotMatch(html, /href=|src=|opaque-1/);
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
        version: "fixture-version",
        online: true,
        isThisDevice: true,
        plugins: [],
      },
      {
        id: "runner",
        name: "Known runner",
        os: "macos",
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

test("Runner inventory excludes paired phones and preserves unknown counts/models", () => {
  const html = renderToStaticMarkup(
    <RunnersPanel runtime={runtimeFixture()} />,
  );
  assert.match(html, /Known runner/);
  assert.doesNotMatch(html, /Paired phone/);
  assert.match(html, /另外 1 台已配对设备不是执行器/);
  assert.match(html, /未报告工具数量/);
  assert.match(html, /未报告模型/);
  assert.match(html, /此处不会向模型服务商发送请求或检查凭据/);
  assert.doesNotMatch(html, />0 个工具</);
});

test("MCP inspection is read-only, excludes phones, and never invents hidden counts", () => {
  const runtime = runtimeFixture();
  runtime.mcp.runnerId = null;
  const html = renderToStaticMarkup(
    <McpPanel runtime={runtime} loading={false} onRefresh={() => {}} />,
  );
  assert.match(html, /查看执行器/);
  assert.match(html, /value="runner" selected=""/);
  assert.doesNotMatch(html, /Paired phone|value="phone"|>0 个已隐藏</);
  assert.match(html, /这不会更改任何机器人或聊天的执行器分配/);
  assert.doesNotMatch(html, /type="checkbox"|保存服务器|添加服务器|移除服务器/);
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
  assert.match(html, /aria-label="搜索对话"/);
  assert.match(html, /aria-label="发送消息"/);
  assert.match(html, /给 dots 发消息/);
  assert.match(html, /aria-label="等待授权"/);
  assert.match(html, /Lorca 原始对话/);
  assert.match(html, /BB Bot 名称/);
  assert.match(html, /value="original-bot-id"/);
  assert.match(html, /<circle cx="10" cy="10" r="3.5"><\/circle>/);
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
  assert.match(html, /影响所有使用该机器人的对话/);
  assert.match(html, /不会迁移正在运行的任务、记忆或 MCP 配置/);
  assert.match(html, /Original model/);
  assert.match(html, /分配执行器/);
  assert.match(html, /独立的安全窗口/);
  assert.match(html, /新增服务商/);
  assert.doesNotMatch(html, /type="password"|textarea|Paired phone/);
});

test("Missing editor capabilities never create writable model or provider controls", () => {
  const html = renderToStaticMarkup(<BotSettingsPanel runtime={runtimeFixture()} disabled={false} onAction={actions.onSettingsAction} />);
  assert.match(html, /未提供此编辑能力/);
  assert.doesNotMatch(html, /应用更改|新增服务商|断开连接/);
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
  assert.match(html, /精确工具：messages\/send_external_message。启用自动审批后，将始终允许此工具；备注不构成限制条件。/);
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
  assert.doesNotMatch(person, /<img|data-avatar-bot/);
});

test("Conversation avatars use at most two ordered bot identities", () => {
  const avatars = ["first", "second", "third"].map((botId) => ({ botId, name: botId, symbolName: "terminal.fill", accent: "teal" }));
  const html = renderToStaticMarkup(<ConversationAvatars avatars={avatars} />);
  assert.match(html, /lorca-avatar-stack/);
  assert.ok(html.indexOf('data-avatar-bot="first"') < html.indexOf('data-avatar-bot="second"'));
  assert.doesNotMatch(html, /data-avatar-bot="third"/);
});

test("Message avatars preserve bot identity and give user messages a person fallback", () => {
  const html = renderMessage({ kind: "message", id: "avatar", role: "assistant", authorName: "Named Bot", authorAvatar: { botId: "named-bot", name: "Named Bot", symbolName: "terminal.fill", accent: "green" }, text: "Synthetic response" });
  assert.match(html, /data-avatar-bot="named-bot"/);
  assert.match(html, /data-icon="ComputerTerminal01"/);
  assert.match(html, /Named Bot/);
  assert.doesNotMatch(html, /<circle cx="10" cy="10" r="3.5"/);
  const user = renderMessage({ kind: "message", id: "user", role: "user", text: "Synthetic message" });
  assert.match(user, /lorca-avatar-person/);
  assert.doesNotMatch(user, /<img/);
});


test("Composer bot selector shows the selected avatar and retains native labels and disabled states", () => {
  const state: LorcaShellState = {
    connection: { status: "connected", endpoint: "ws://127.0.0.1:4862/ws" },
    conversations: [], activeConversationId: null, messages: [],
    agents: [{ id: "selected-bot", label: "Selected Bot", appearance: { botId: "selected-bot", name: "Selected Bot", symbolName: "terminal.fill", accent: "green", image: "data:image/png;base64,iVBORw0KGgo=" } }],
    selectedAgentId: "selected-bot", busy: false, loading: false,
    hasMore: false, loadingOlder: false, error: null, queue: [], demo: false,
  };
  const picker = (value: LorcaShellState) => {
    const html = renderToStaticMarkup(<LorcaShell state={value} actions={actions} />);
    const start = html.indexOf('class="lorca-agent-picker"');
    assert.notEqual(start, -1);
    return html.slice(start, html.indexOf("</select>", start) + 9);
  };
  const enabled = picker(state);
  assert.match(enabled, /data-avatar-bot="selected-bot"/);
  assert.match(enabled, /<img[^>]+data-avatar-image/);
  assert.match(enabled, /<select aria-label="选择机器人"/);
  assert.match(enabled, /<option value="selected-bot" selected="">Selected Bot<\/option>/);
  assert.doesNotMatch(enabled, /data-icon="Bot"|<select[^>]+disabled/);
  assert.doesNotMatch(enabled.slice(enabled.indexOf("<select")), /<img|<svg/);
  for (const patch of [{ busy: true }, { loading: true }, { activeConversationId: "existing-chat" }, { agents: [], selectedAgentId: null }]) {
    assert.match(picker({ ...state, ...patch }), /<select[^>]+disabled=""/);
  }
  const noImage = picker({ ...state, agents: state.agents.map((agent) => ({ ...agent, appearance: agent.appearance && { ...agent.appearance, image: undefined } })) });
  assert.match(noImage, /data-icon="ComputerTerminal01"/);
  assert.doesNotMatch(noImage, /<img/);
});
