import type { SimulationNodeDatum, SimulationLinkDatum } from "d3-force";

// Rendering domain for the bubble map. Data is real and comes from the node's
// /floor endpoint (see lib/floor.ts); these are just the shapes and geometry
// helpers the canvas/simulation layer needs.

export type Way = "LONG" | "SHORT" | "NOTR";

export interface Agent extends SimulationNodeDatum {
  id: string; // `${name}@${roomId}`
  name: string;
  room: string;
  score: number; // excellence score, 0..1
  way: Way | null;
  live: boolean;
  lastActive: number; // ms timestamp of last message activity (0 = none)
  /** Inactive background node (top-100 by score, not in any room). */
  ambient?: boolean;
}

export interface Link extends SimulationLinkDatum<Agent> {
  room: string;
}

export function radiusFor(score: number): number {
  return 24 + Math.max(0, Math.min(1, score)) * 32;
}

/** Discussion lattice for one room: a ring plus a few chords, so a cluster
 * reads as a connected mesh without drowning in lines. */
export function roomLinks(members: Agent[]): Link[] {
  const room = members[0]?.room;
  if (!room || members.length < 2) return [];
  const links: Link[] = [];
  const n = members.length;
  for (let i = 0; i < n; i++) {
    links.push({ source: members[i], target: members[(i + 1) % n], room });
  }
  const chords = Math.min(Math.floor(n / 3), 4);
  for (let c = 0; c < chords; c++) {
    const a = members[Math.floor(Math.random() * n)];
    const b = members[Math.floor(Math.random() * n)];
    if (a !== b) links.push({ source: a, target: b, room });
  }
  return links;
}
