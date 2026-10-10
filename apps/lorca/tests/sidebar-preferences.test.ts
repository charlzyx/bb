import test from "node:test";
import assert from "node:assert/strict";
import { bucketConversations, readSidebarPreferences, recentBucket, writeSidebarPreferences } from "../src/ui/sidebar-preferences";

test("Recent conversations occupy nonoverlapping local calendar-day buckets", () => {
  const now = new Date(2026, 9, 10, 0, 5);
  for (const [age, bucket] of [[0, "today"], [1, "three-days"], [2, "three-days"], [3, "week"], [6, "week"], [7, "older"], [50, "older"]] as const) {
    assert.equal(recentBucket(new Date(2026, 9, 10 - age, 23, 59).toISOString(), now), bucket);
  }
  const chats = Array.from({ length: 12 }, (_, index) => ({ id: String(index), title: "Fixture", updatedAt: new Date(2026, 9, 10 - index).toISOString(), status: "idle" as const }));
  const grouped = bucketConversations(chats, now);
  assert.deepEqual(grouped.map(group => group.conversations.length), [1, 2, 4, 5]);
  assert.equal(new Set(grouped.flatMap(group => group.conversations.map(chat => chat.id))).size, 12);
  assert.equal(recentBucket("invalid", now), "older");
});
test("Sidebar view and folding preferences remain account isolated and do not modify groups", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  assert.equal(writeSidebarPreferences(undefined, { view: "teams", collapsed: [] }, storage), false);
  assert.equal(values.size, 0);
  assert.equal(writeSidebarPreferences("account-a", { view: "teams", collapsed: ["week"] }, storage), true);
  assert.deepEqual(readSidebarPreferences("account-a", storage), { view: "teams", collapsed: ["week"] });
  assert.deepEqual(readSidebarPreferences("account-b", storage), { view: "recent", collapsed: [] });
  assert.ok([...values.keys()].every(key => key.startsWith("dots.sidebar.v1:")));
});
test("Malformed or unavailable sidebar storage has a safe transient default", () => {
  assert.deepEqual(readSidebarPreferences("account", { getItem: () => '{"view":"teams","collapsed":["unknown"]}' }), { view: "recent", collapsed: [] });
  assert.equal(writeSidebarPreferences("account", { view: "teams", collapsed: [] }, { setItem: () => { throw new Error("quota"); } }), false);
});
