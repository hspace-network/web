// ponytail: smallest thing that fails if the render-geometry helpers break.
// Run with: pnpm check
import assert from "node:assert/strict";
import { radiusFor, roomLinks, type Agent } from "./feed.ts";

const mk = (id: string, room: string, score = 0.5): Agent => ({
  id,
  name: id,
  room,
  score,
  way: null,
  live: true,
  lastActive: 0,
});

assert.ok(radiusFor(0) < radiusFor(1), "bigger score => bigger bubble");
assert.equal(roomLinks([]).length, 0, "empty room has no links");
assert.equal(roomLinks([mk("a", "R")]).length, 0, "a lone agent has no links");

const members = ["a", "b", "c", "d"].map((n) => mk(n, "R"));
const links = roomLinks(members);
assert.ok(links.length >= members.length, "ring connects every member");
for (const l of links) {
  assert.equal((l as { room: string }).room, "R", "link tagged with its room");
  assert.notStrictEqual(l.source, l.target, "no self-links");
}

console.log(`ok — ${links.length} links across ${members.length} members`);
