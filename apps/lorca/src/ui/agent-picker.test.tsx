import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentPicker, filterPickerAgents } from "./AgentPicker";

test("Agent picker filters labels without modifying IDs or ordering", () => {
  const agents = [{ id: "one", label: "Duo" }, { id: "two", label: "研究" }];
  assert.deepEqual(filterPickerAgents(agents, " DUO "), [agents[0]]);
  assert.deepEqual(filterPickerAgents(agents, ""), agents);
  assert.deepEqual(filterPickerAgents(agents, "missing"), []);
});
test("Agent picker uses a labeled popover button and safe real avatar", () => {
  const html = renderToStaticMarkup(<AgentPicker agents={[{ id: "one", label: "Duo", appearance: { botId: "one", name: "Duo", symbolName: "terminal", accent: "gray", image: "data:image/png;base64,YQ==" } }]} selectedAgentId="one" onSelectAgent={() => { throw new Error("Render must not select"); }} />);
  assert.match(html, /aria-label="选择智能体"/);
  assert.match(html, /aria-haspopup="dialog"/);
  assert.match(html, /Duo/);
  assert.doesNotMatch(html, /<select|<option/);
});
test("No agents disables the picker instead of offering a fake target", () => {
  const html = renderToStaticMarkup(<AgentPicker agents={[]} onSelectAgent={() => {}} />);
  assert.match(html, /disabled=""/);
  assert.match(html, /暂无智能体/);
});
