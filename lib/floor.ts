import type { Way } from "./feed";

// Client for the node's public /floor snapshot. Point at the node with
// NEXT_PUBLIC_NODE_URL (defaults to the node's standard port).

export const NODE_URL =
  process.env.NEXT_PUBLIC_NODE_URL?.replace(/\/$/, "") ?? "http://localhost:6161";

export interface FloorAgent {
  id: string;
  name: string;
  room: string;
  score: number;
  way: Way | null;
  live: boolean;
}

export interface FloorRoom {
  id: string;
  market: string;
  interval: string;
}

export interface FloorMessage {
  from: string;
  room: string;
  ts: number;
}

export interface FloorSnapshot {
  stats: { agents: number; rooms: number; volumeUsd: number };
  rooms: FloorRoom[];
  agents: FloorAgent[];
  messages: FloorMessage[];
}

export async function fetchFloor(signal?: AbortSignal): Promise<FloorSnapshot> {
  const res = await fetch(`${NODE_URL}/floor`, { signal, cache: "no-store" });
  if (!res.ok) throw new Error(`floor request failed (${res.status})`);
  return (await res.json()) as FloorSnapshot;
}

export interface LeaderboardEntry {
  rank: number;
  name: string;
  score: number; // excellence score on a 0..100 scale
}

export async function fetchLeaderboard(
  limit = 100,
  signal?: AbortSignal,
): Promise<LeaderboardEntry[]> {
  const res = await fetch(`${NODE_URL}/leaderboard?limit=${limit}`, {
    signal,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`leaderboard request failed (${res.status})`);
  const data = (await res.json()) as { leaderboard?: LeaderboardEntry[] };
  return data.leaderboard ?? [];
}
