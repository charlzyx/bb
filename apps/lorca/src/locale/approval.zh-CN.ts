export const approvalZh = {
  title: "自动审批",
  description: "设置工具调用的审核方式，以及需要始终询问或可以自动批准的情景。",
  unavailableTitle: "自动审批设置暂不可用",
  unavailableDescription:
    "当前连接未提供可编辑的自动审批设置。请连接支持此功能的本地运行环境后刷新；这里不会推断或更改现有权限。",
  unknownStateDescription:
    "运行环境尚未报告自动审批是否开启。请刷新设置，确认当前状态后再修改。",
  enabled: "开启",
  disabled: "关闭",
  enableLabel: "启用自动审批",
  enabledDescription:
    "开启后，模型会结合请求和规则进行审核，符合允许规则的操作可自动批准。开启不代表允许所有操作。",
  disabledDescription:
    "关闭后，每次工具调用都会询问你，允许规则也不会自动放行。",
  draftNotice: "修改仅保留在此页面。查看变更并确认后才会提交。",
  rulesTitle: "审核规则",
  rulesDescription:
    "用自然语言描述适用情景。新规则默认“始终询问”；可选填工具名称以限定范围。",
  rulesDisabled: "自动审批关闭时，这些规则会保留，但不会自动批准操作。",
  noRules: "还没有审核规则",
  noRulesDescription: "添加一条具体规则，明确哪些操作需要询问你。",
  addRule: "添加规则",
  ruleLabel: (index: number) => `规则 ${index}`,
  ruleText: "适用情景",
  ruleTextPlaceholder: "例如：发送任何对外消息前先询问我",
  ruleBehavior: "处理方式",
  ask: "始终询问",
  allow: "符合规则时允许",
  ruleTool: "工具名称（可选）",
  ruleToolPlaceholder: "留空表示不限定工具",
  removeRule: (index: number) => `删除规则 ${index}`,
  emptyRuleError: "请填写每条规则的适用情景，或删除空规则。",
  review: "查看变更",
  reset: "还原修改",
  reviewTitle: "确认自动审批变更",
  reviewDescription:
    "这次提交会替换整张规则表。请核对下面的最终状态和全部规则；未列出的旧规则将被删除。",
  reviewEnabled:
    "最终状态：开启。模型审核和允许规则可能减少确认次数，但不会允许所有操作。",
  reviewDisabled:
    "最终状态：关闭。每次工具调用都必须询问，允许规则不会自动放行。",
  reviewNoRules: "最终规则表为空，现有规则将全部移除。",
  ruleScope: (tool: string) => `仅限工具：${tool}`,
  allTools: "不限定工具",
  nativeConfirmation: "提交时，本地应用还会独立确认本次权限变更。",
  confirm: "确认并提交",
  cancel: "返回修改",
  submitting: "正在提交…",
  applied: "变更已应用。刷新设置后可继续编辑。",
  cancelled: "已取消提交，草稿仍保留，未确认应用任何变更。",
  unknownOutcome:
    "无法确认提交结果。草稿仍保留，请先刷新并核对实际设置，避免重复提交。",
  failed: "提交失败，草稿仍保留。请检查连接后重试。",
} as const;
