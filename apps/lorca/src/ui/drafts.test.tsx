import assert from "node:assert/strict";
import test from "node:test";
import { settleSubmittedDraft } from "./drafts";

test("Returning an existing unique DM preserves its unsent draft", () => {
  const drafts = { __new__: "Send this now", existing: "Send this later" };
  assert.deepEqual(settleSubmittedDraft(drafts, "__new__", "Send this now", "existing"), {
    __new__: "",
    existing: "Send this later",
  });
  assert.equal(drafts.__new__, "Send this now");
});

test("A pending new-chat edit and an existing DM draft remain separate", () => {
  assert.deepEqual(settleSubmittedDraft({ __new__: "New follow-up", existing: "Older draft" }, "__new__", "Submitted", "existing"), {
    __new__: "New follow-up",
    existing: "Older draft",
  });
});

test("New-chat edits migrate only into an empty destination draft", () => {
  for (const existing of [undefined, ""]) {
    assert.deepEqual(settleSubmittedDraft({ __new__: "New follow-up", ...(existing === undefined ? {} : { existing }) }, "__new__", "Submitted", "existing"), {
      __new__: "",
      existing: "New follow-up",
    });
  }
});

test("Acknowledgements clear only their submitted text and preserve newer navigation", () => {
  assert.deepEqual(settleSubmittedDraft({ __new__: "Submitted", other: "Other draft" }, "__new__", "Submitted", null), {
    __new__: "",
    other: "Other draft",
  });
  assert.deepEqual(settleSubmittedDraft({ existing: "Edited", other: "Other draft" }, "existing", "Submitted", null), {
    existing: "Edited",
    other: "Other draft",
  });
});
