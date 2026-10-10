import { Icon } from "@bb/shared-ui/icon";
import { zhCN } from "../locale/zh-CN";
import type { LorcaShellState } from "./types";

export function ComposerRunnerStatus({ summary }: { summary: LorcaShellState["runnerSummary"] }) {
  const label = summary?.kind === "single" ? summary.device.name
    : summary?.kind === "multiple" ? zhCN.chat.runnerMultiple
      : summary?.kind === "unassigned" ? zhCN.chat.runnerUnassigned
        : zhCN.chat.runnerUnknown;
  const status = summary?.kind === "single" ? summary.device.online ? zhCN.chat.runnerOnline : zhCN.chat.runnerOffline : null;
  return (
    <span className="lorca-runner-summary" data-runner-kind={summary?.kind ?? "unknown"} title={`${zhCN.chat.runnerDevice}：${label}${status ? ` · ${status} · ${zhCN.chat.runnerReportedStatus}` : ""}`}>
      <Icon name="Terminal" />
      <span className="lorca-runner-name">{label}</span>
      {status && <span className="lorca-runner-status" data-online={summary?.kind === "single" && summary.device.online}>{status}</span>}
    </span>
  );
}
