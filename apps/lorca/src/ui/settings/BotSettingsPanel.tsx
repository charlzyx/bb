import { useState } from "react";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { SettingsBadge, SettingsRow, SettingsRowList, SettingsSection } from "../../../../app/src/components/ui/settings-section";
import { editorZh } from "../../locale/editor.zh-CN";
import { settingsZh } from "../../locale/settings.zh-CN";
import type { RuntimeSettings, SettingsAction, SettingsActionResult, SettingsEditor } from "../types";
import { SettingsActionControl, SettingsMutationStatus, useSettingsMutation } from "./SettingsActionControl";

export function BotSettingsPanel({ runtime, disabled, onAction, selectedBotId, onSelectBot }: { runtime: RuntimeSettings; disabled: boolean; onAction: (action: SettingsAction) => Promise<SettingsActionResult>; selectedBotId?: string; onSelectBot?: (id: string) => void }) {
  const [localBotId, setLocalBotId] = useState(runtime.bots[0]?.id ?? "");
  const selectedBot = selectedBotId ?? localBotId;
  const setSelectedBot = (id: string) => { setLocalBotId(id); onSelectBot?.(id); };
  const bot = runtime.bots.find((item) => item.id === selectedBot) ?? runtime.bots[0];
  const editor = runtime.editor;
  return <>
    <SettingsSection title={editorZh.botSettings} description={editorZh.botScope}>
      {bot ? <>
        <label htmlFor="lorca-edit-bot">{editorZh.selectBot}</label>
        <div className="lorca-settings-select">
          <select id="lorca-edit-bot" value={bot.id} disabled={disabled} onChange={(event) => setSelectedBot(event.target.value)}>
            {runtime.bots.map((item) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}
          </select><Icon name="ChevronDown" />
        </div>
        {editor?.canUpdateBots ? <BotEditor key={`${bot.id}:${editor.revision}`} runtime={runtime} editor={editor} bot={bot} disabled={disabled} onAction={onAction} /> : <p className="lorca-admin-unavailable">{editorZh.unsupported}</p>}
      </> : <p className="lorca-runtime-muted">{editorZh.noBots}</p>}
    </SettingsSection>
    <SettingsSection title={editorZh.manageProviders} description={editorZh.providersDescription} action={editor?.canAddProvider ? <SettingsActionControl action={{ kind: "provider.configure", revision: editor.revision }} label={editorZh.addProvider} onAction={onAction} disabled={disabled} /> : <SettingsBadge>{settingsZh.readOnly}</SettingsBadge>}>
      <SettingsRowList>
        {runtime.providers.map((provider) => {
          const capability = editor?.providers.find((item) => item.id === provider.id);
          return <SettingsRow key={provider.id} className="lorca-admin-provider-row">
            <div><strong>{provider.name || provider.id}</strong><p className="lorca-runtime-muted">{provider.connected ? settingsZh.configured : settingsZh.notConfigured}</p></div>
            {editor && capability ? <div className="lorca-admin-buttons">
              {capability.canConfigure && <SettingsActionControl action={{ kind: "provider.configure", revision: editor.revision, providerId: provider.id }} label={editorZh.configure} onAction={onAction} disabled={disabled} />}
              {capability.canDisconnect && <SettingsActionControl action={{ kind: "provider.disconnect", revision: editor.revision, providerId: provider.id }} label={editorZh.disconnect} confirmation={editorZh.disconnectScope(provider.name || provider.id)} onAction={onAction} disabled={disabled} />}
              {!capability.canConfigure && !capability.canDisconnect && <SettingsBadge>{settingsZh.readOnly}</SettingsBadge>}
            </div> : <SettingsBadge>{settingsZh.readOnly}</SettingsBadge>}
          </SettingsRow>;
        })}
      </SettingsRowList>
      {(!editor || (!editor.canAddProvider && !editor.providers.some((provider) => provider.canConfigure || provider.canDisconnect))) && <p className="lorca-admin-unavailable">{editorZh.unsupported}</p>}
      <p className="lorca-input-help">{editorZh.nativeOnly}</p>
    </SettingsSection>
  </>;
}

function BotEditor({ runtime, editor, bot, disabled, onAction }: { runtime: RuntimeSettings; editor: SettingsEditor; bot: RuntimeSettings["bots"][number]; disabled: boolean; onAction: (action: SettingsAction) => Promise<SettingsActionResult> }) {
  const initialThinking = editor.bots.find((item) => item.id === bot.id)?.thinking ?? "";
  const [provider, setProvider] = useState(bot.provider ?? "");
  const [model, setModel] = useState(bot.model ?? "");
  const [thinking, setThinking] = useState(initialThinking);
  const [runnerId, setRunnerId] = useState(bot.runnerId);
  const [confirming, setConfirming] = useState(false);
  const mutation = useSettingsMutation(onAction);
  const models = editor.models.filter((item) => item.provider === provider);
  const levels = models.find((item) => item.id === model)?.levels ?? [];
  const runners = runtime.devices.filter((device) => ["macos", "linux", "windows"].includes(device.os));
  const dirty = provider !== (bot.provider ?? "") || model !== (bot.model ?? "") || thinking !== initialThinking || runnerId !== bot.runnerId;
  const blocked = disabled || mutation.pending || mutation.result === "unknownOutcome" || mutation.result === "applied";
  const edited = () => { setConfirming(false); mutation.reset(); };
  const action: SettingsAction = { kind: "bot.update", revision: editor.revision, botId: bot.id,
    ...(provider !== (bot.provider ?? "") ? { provider } : {}),
    ...(model !== (bot.model ?? "") || provider !== (bot.provider ?? "") ? { model } : {}),
    ...(thinking !== initialThinking || provider !== (bot.provider ?? "") || model !== (bot.model ?? "") ? { thinking } : {}),
    ...(runnerId !== bot.runnerId ? { runnerId } : {}),
  };
  return <form className="lorca-admin-form" onSubmit={(event) => { event.preventDefault(); if (!blocked && dirty) setConfirming(true); }}>
    <fieldset disabled={blocked}>
      <div className="lorca-admin-grid">
        <div><label htmlFor="lorca-bot-provider">{editorZh.provider}</label><div className="lorca-settings-select"><select id="lorca-bot-provider" value={provider} onChange={(event) => { setProvider(event.target.value); setModel(""); setThinking(""); edited(); }}>
          {!runtime.providers.some((item) => item.id === provider) && <option value={provider} disabled>{provider || editorZh.unreportedValue}</option>}
          {runtime.providers.map((item) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}
        </select><Icon name="ChevronDown" /></div></div>
        <div><label htmlFor="lorca-bot-model">{editorZh.model}</label><div className="lorca-settings-select"><select id="lorca-bot-model" value={model} onChange={(event) => { setModel(event.target.value); setThinking(""); edited(); }}>
          <option value="">{editorZh.defaultValue}</option>
          {model && !models.some((item) => item.id === model) && <option value={model} disabled>{model}</option>}
          {models.map((item) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}
        </select><Icon name="ChevronDown" /></div><p className="lorca-input-help">{editorZh.modelHelp}</p></div>
        <div><label htmlFor="lorca-bot-thinking">{editorZh.thinking}</label><div className="lorca-settings-select"><select id="lorca-bot-thinking" value={thinking} onChange={(event) => { setThinking(event.target.value); edited(); }}>
          <option value="">{editorZh.defaultValue}</option>
          {thinking && !levels.includes(thinking) && <option value={thinking} disabled>{thinking}</option>}
          {levels.map((level) => <option key={level} value={level}>{level}</option>)}
        </select><Icon name="ChevronDown" /></div><p className="lorca-input-help">{editorZh.thinkingHelp}</p></div>
        <div><label htmlFor="lorca-bot-runner">{editorZh.runner}</label><div className="lorca-settings-select"><select id="lorca-bot-runner" value={runnerId} onChange={(event) => { setRunnerId(event.target.value); edited(); }}>
          {!runners.some((item) => item.id === runnerId) && <option value={runnerId} disabled>{runnerId || editorZh.unreportedValue}</option>}
          {runners.map((item) => <option key={item.id} value={item.id}>{item.name || item.id}{item.online ? "" : ` · ${editorZh.offline}`}</option>)}
        </select><Icon name="ChevronDown" /></div><p className="lorca-input-help">{editorZh.runnerHelp}</p></div>
      </div>
    </fieldset>
    {confirming ? <div className="lorca-admin-confirmation" role="group" aria-label={editorZh.reviewChanges}><p>{editorZh.botConfirm(bot.name || bot.id)}</p><div className="lorca-admin-buttons"><Button type="button" size="sm" disabled={blocked} onClick={() => { setConfirming(false); void mutation.run(action); }}>{editorZh.confirm}</Button><Button type="button" size="sm" variant="ghost" disabled={blocked} onClick={() => setConfirming(false)}>{editorZh.cancel}</Button></div></div> : <div className="lorca-settings-form-actions"><Button type="submit" size="sm" disabled={blocked || !dirty}>{mutation.pending ? editorZh.saving : editorZh.apply}</Button></div>}
    <SettingsMutationStatus result={mutation.result} error={mutation.error} />
  </form>;
}
