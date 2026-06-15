"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchSessionVerification,
  recomputeSessionRoot,
  foldProof,
  readOnchainRoot,
  eqHex,
  isZeroRoot,
  shortHex,
  type SessionVerification,
} from "@/lib/verify";

type Status = "idle" | "loading" | "done" | "error";
type StepState = "pass" | "fail" | "pending" | "warn";

interface Derived {
  voteRoot: `0x${string}`;
  sessionRoot: `0x${string}`;
}

function StepIcon({ state }: { state: StepState }) {
  if (state === "pass") {
    return (
      <svg viewBox="0 0 20 20" className="h-5 w-5 text-emerald-400" fill="none" aria-hidden>
        <circle cx="10" cy="10" r="9" stroke="currentColor" strokeOpacity="0.4" />
        <path d="M6 10.5l2.5 2.5L14 7.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (state === "fail") {
    return (
      <svg viewBox="0 0 20 20" className="h-5 w-5 text-red-400" fill="none" aria-hidden>
        <circle cx="10" cy="10" r="9" stroke="currentColor" strokeOpacity="0.4" />
        <path d="M7 7l6 6M13 7l-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (state === "warn") {
    return (
      <svg viewBox="0 0 20 20" className="h-5 w-5 text-accent" fill="none" aria-hidden>
        <circle cx="10" cy="10" r="9" stroke="currentColor" strokeOpacity="0.4" />
        <path d="M10 6v5M10 13.5v.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <span className="block h-5 w-5 rounded-full border border-faint" aria-hidden>
      <span className="block h-full w-full animate-pulse rounded-full bg-muted/20" />
    </span>
  );
}

function StepRow({
  state,
  title,
  detail,
}: {
  state: StepState;
  title: string;
  detail?: React.ReactNode;
}) {
  return (
    <li className="flex gap-3 rounded-lg border border-line bg-surface/40 p-3">
      <span className="mt-0.5 shrink-0">
        <StepIcon state={state} />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-text">{title}</p>
        {detail ? <div className="mt-1 text-xs text-muted">{detail}</div> : null}
      </div>
    </li>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <code className="break-all font-mono text-[11px] text-faint">{children}</code>
  );
}

export default function Verifier({ initialSession }: { initialSession: string }) {
  const [sessionId, setSessionId] = useState(initialSession);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SessionVerification | null>(null);
  const [derived, setDerived] = useState<Derived | null>(null);
  const [foldedHourly, setFoldedHourly] = useState<`0x${string}` | null>(null);
  const [onchainRoot, setOnchainRoot] = useState<`0x${string}` | null>(null);
  const [onchainError, setOnchainError] = useState<string | null>(null);

  const verify = useCallback(async (id: string) => {
    const trimmed = id.trim();
    if (!trimmed) return;
    setStatus("loading");
    setError(null);
    setData(null);
    setDerived(null);
    setFoldedHourly(null);
    setOnchainRoot(null);
    setOnchainError(null);

    let v: SessionVerification;
    try {
      v = await fetchSessionVerification(trimmed);
    } catch (err) {
      setError((err as Error).message);
      setStatus("error");
      return;
    }

    const d = recomputeSessionRoot(v);
    setData(v);
    setDerived(d);

    if (v.hourBucket && v.hourlyRoot) {
      setFoldedHourly(foldProof(d.sessionRoot, v.proof));
    }

    if (v.anchored && v.contractAddress && v.hourBucket) {
      try {
        const root = await readOnchainRoot({
          contractAddress: v.contractAddress,
          chainId: v.chainId,
          hourBucket: v.hourBucket,
        });
        setOnchainRoot(root);
      } catch (err) {
        setOnchainError((err as Error).message);
      }
    }

    setStatus("done");
  }, []);

  useEffect(() => {
    if (!initialSession.trim()) return;
    // Defer so the initial state updates don't run synchronously inside the
    // effect body (and to avoid cascading renders on mount).
    queueMicrotask(() => void verify(initialSession));
    // run once for a deep-linked ?session=
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void verify(sessionId);
  };

  // --- derive step states -----------------------------------------------
  const step1: StepState =
    data && derived
      ? eqHex(derived.sessionRoot, data.sessionRoot)
        ? "pass"
        : "fail"
      : "pending";

  const step2: StepState =
    data && derived
      ? data.hourBucket && data.hourlyRoot && foldedHourly
        ? eqHex(foldedHourly, data.hourlyRoot)
          ? "pass"
          : "fail"
        : "pending"
      : "pending";

  const step3: StepState = !data
    ? "pending"
    : !data.anchored
      ? "pending"
      : onchainError
        ? "warn"
        : onchainRoot
          ? !isZeroRoot(onchainRoot) && eqHex(onchainRoot, data.hourlyRoot)
            ? "pass"
            : "fail"
          : "pending";

  const verified =
    step1 === "pass" && step2 === "pass" && step3 === "pass";
  const offchainOnly =
    step1 === "pass" && step2 === "pass" && data && !data.anchored;

  return (
    <div className="w-full max-w-2xl">
      <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row">
        <input
          value={sessionId}
          onChange={(e) => setSessionId(e.target.value)}
          placeholder="Paste a discussion session id (UUID)"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-text placeholder:text-faint focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          disabled={status === "loading" || !sessionId.trim()}
          className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-navy-deep transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === "loading" ? "Verifying…" : "Verify"}
        </button>
      </form>

      {error ? (
        <p className="mt-4 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      ) : null}

      {data ? (
        <div className="mt-5 space-y-4">
          {verified ? (
            <div className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-4 py-3">
              <p className="text-sm font-semibold text-emerald-300">
                Verified on Mantle
              </p>
              <p className="mt-0.5 text-xs text-emerald-200/70">
                The votes recompute to the anchored root, and that root is the
                one stored on-chain.
              </p>
            </div>
          ) : offchainOnly ? (
            <div className="rounded-lg border border-accent/30 bg-accent/10 px-4 py-3">
              <p className="text-sm font-semibold text-accent">
                Off-chain proof valid — awaiting on-chain anchor
              </p>
              <p className="mt-0.5 text-xs text-muted">
                Votes recompute to the session root. This hour has not been
                anchored to Mantle yet.
              </p>
            </div>
          ) : null}

          <ol className="space-y-2">
            <StepRow
              state={step1}
              title="1 · Votes recompute to the session root"
              detail={
                derived ? (
                  <div className="space-y-0.5">
                    <div>recomputed: <Mono>{shortHex(derived.sessionRoot)}</Mono></div>
                    <div>node value: <Mono>{shortHex(data.sessionRoot)}</Mono></div>
                  </div>
                ) : null
              }
            />
            <StepRow
              state={step2}
              title="2 · Session root proves into the hourly root"
              detail={
                data.hourBucket ? (
                  <div className="space-y-0.5">
                    <div>hour bucket: <Mono>{data.hourBucket}</Mono> · {data.sessionCount} session(s)</div>
                    <div>folded: <Mono>{shortHex(foldedHourly)}</Mono></div>
                    <div>hourly root: <Mono>{shortHex(data.hourlyRoot)}</Mono></div>
                  </div>
                ) : (
                  <span>Not yet queued for anchoring.</span>
                )
              }
            />
            <StepRow
              state={step3}
              title="3 · Hourly root is stored on the SessionAnchor contract"
              detail={
                !data.anchored ? (
                  <span>Not yet anchored on-chain.</span>
                ) : onchainError ? (
                  <span>Could not reach Mantle RPC ({onchainError}). Off-chain proof still holds.</span>
                ) : (
                  <div className="space-y-0.5">
                    <div>on-chain: <Mono>{shortHex(onchainRoot)}</Mono></div>
                    {data.contractAddress ? (
                      <div>contract: <Mono>{data.contractAddress}</Mono></div>
                    ) : null}
                    {data.explorerTxUrl ? (
                      <a
                        href={data.explorerTxUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent underline hover:brightness-110"
                      >
                        view anchor transaction →
                      </a>
                    ) : null}
                  </div>
                )
              }
            />
          </ol>

          <details className="rounded-lg border border-line bg-surface/40 p-3">
            <summary className="cursor-pointer text-sm font-medium text-text">
              Final votes ({data.votes.length}) · {data.roomId} · move {data.priceMove}
            </summary>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-faint">
                  <tr>
                    <th className="pb-1 pr-3 font-medium">agent</th>
                    <th className="pb-1 pr-3 font-medium">way</th>
                    <th className="pb-1 pr-3 font-medium">size $</th>
                    <th className="pb-1 font-medium">rationale</th>
                  </tr>
                </thead>
                <tbody className="text-muted">
                  {data.votes.map((v, i) => (
                    <tr key={i} className="border-t border-line/60">
                      <td className="py-1 pr-3 text-text">{v.agentName}</td>
                      <td className="py-1 pr-3">{v.way}</td>
                      <td className="py-1 pr-3">{v.sizeUsd}</td>
                      <td className="py-1">{v.rationale}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[11px] text-faint">
                prices p0={data.priceP0} → p1={data.priceP1}
              </p>
            </div>
          </details>
        </div>
      ) : null}
    </div>
  );
}
