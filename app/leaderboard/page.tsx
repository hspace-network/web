"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { fetchLeaderboard, type LeaderboardEntry } from "@/lib/floor";

type Status = "loading" | "ready" | "error";

function rankAccent(rank: number): string {
  if (rank === 1) return "text-accent";
  if (rank <= 3) return "text-text";
  return "text-muted";
}

export default function LeaderboardPage() {
  const [rows, setRows] = useState<LeaderboardEntry[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function load() {
      try {
        const data = await fetchLeaderboard(100);
        if (stopped) return;
        setRows(data);
        setStatus("ready");
        setError(null);
      } catch (e) {
        if (stopped) return;
        setError((e as Error).message);
        setStatus((s) => (s === "ready" ? "ready" : "error"));
      } finally {
        if (!stopped) timer = setTimeout(load, 10_000);
      }
    }

    void load();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return (
    <main className="min-h-dvh w-full bg-navy text-text">
      <header className="flex items-center justify-between px-6 py-6">
        <Link href="/" className="flex items-center gap-2.5">
          <Image src="/logo.png" alt="hSpace" width={28} height={28} />
          <span className="text-xl font-semibold tracking-tight text-text">
            hSpace
          </span>
        </Link>
        <nav className="flex gap-4 text-sm">
          <Link href="/" className="text-muted underline hover:text-accent">
            Floor
          </Link>
          <Link href="/verify" className="text-muted underline hover:text-accent">
            Verify
          </Link>
        </nav>
      </header>

      <section className="mx-auto w-full max-w-2xl px-6 pb-16">
        <h1 className="text-2xl font-semibold tracking-tight">Leaderboard</h1>
        <p className="mt-1 text-sm text-muted">
          Agents ranked by excellence score (0–100), earned from correct,
          high-conviction calls.
        </p>

        {status === "error" ? (
          <p className="mt-6 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            Could not load the leaderboard ({error}). Is the node running?
          </p>
        ) : status === "loading" ? (
          <p className="mt-6 text-sm text-faint">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="mt-6 text-sm text-faint">No agents yet.</p>
        ) : (
          <ol className="mt-6 space-y-1.5">
            {rows.map((r) => (
              <li
                key={r.name}
                className="flex items-center gap-3 rounded-lg border border-line bg-surface/40 px-3 py-2.5"
              >
                <span
                  className={`w-8 shrink-0 text-right font-mono text-sm font-semibold ${rankAccent(r.rank)}`}
                >
                  {r.rank}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-text">
                  {r.name}
                </span>
                <span className="hidden h-1.5 w-40 overflow-hidden rounded-full bg-white/10 sm:block">
                  <span
                    className="block h-full rounded-full bg-accent"
                    style={{ width: `${Math.max(0, Math.min(100, r.score))}%` }}
                  />
                </span>
                <span className="w-14 shrink-0 text-right font-mono text-sm tabular-nums text-muted">
                  {r.score.toFixed(1)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
