import {
  createPublicClient,
  http,
  keccak256,
  toBytes,
  encodeAbiParameters,
  type PublicClient,
} from "viem";
import { mantle, mantleSepoliaTestnet } from "viem/chains";
import { NODE_URL } from "./floor";

// Trustless verifier helpers. Everything here re-derives the on-chain Merkle
// root from the raw session inputs *in the browser*, so a user never has to
// trust the node: they recompute the leaves, fold the proof, and read the root
// straight from the SessionAnchor contract on Mantle.

export interface VerificationVote {
  agentName: string;
  way: string;
  sizeUsd: number;
  rationale: string;
}

export interface SessionVerification {
  sessionId: string;
  roomId: string;
  priceP0: number;
  priceP1: number;
  priceMove: string;
  votes: VerificationVote[];
  voteRoot: `0x${string}`;
  sessionRoot: `0x${string}`;
  hourBucket: string | null;
  hourlyRoot: string | null;
  proof: `0x${string}`[];
  anchored: boolean;
  txHash: string | null;
  sessionCount: number;
  contractAddress: string | null;
  chainId: number;
  explorerTxUrl: string | null;
}

export async function fetchSessionVerification(
  sessionId: string,
  signal?: AbortSignal,
): Promise<SessionVerification> {
  const res = await fetch(
    `${NODE_URL}/anchor/session/${encodeURIComponent(sessionId)}`,
    { signal, cache: "no-store" },
  );
  if (res.status === 404) {
    throw new Error("No session with that id was found on the node.");
  }
  if (!res.ok) {
    let msg = `Request failed (${res.status}).`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) msg = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return (await res.json()) as SessionVerification;
}

// --- Re-derivation (must mirror node/src/services/anchor.service.ts) ---------

const cmpHex = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function hashRationale(rationale: string): `0x${string}` {
  return keccak256(toBytes(rationale));
}

export function voteLeaf(
  sessionId: string,
  agentName: string,
  way: string,
  sizeUsd: number,
  rationale: string,
): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "string" },
        { type: "string" },
        { type: "string" },
        { type: "uint256" },
        { type: "bytes32" },
      ],
      [
        sessionId,
        agentName,
        way,
        BigInt(Math.round(sizeUsd * 1000)),
        hashRationale(rationale),
      ],
    ),
  );
}

function hashPair(a: `0x${string}`, b: `0x${string}`): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }],
      a < b ? [a, b] : [b, a],
    ),
  );
}

export function merkleRoot(leaves: `0x${string}`[]): `0x${string}` {
  if (leaves.length === 0) return keccak256(toBytes("empty"));
  let layer = [...leaves].sort(cmpHex);
  while (layer.length > 1) {
    const next: `0x${string}`[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i]!;
      const right = i + 1 < layer.length ? layer[i + 1]! : left;
      next.push(hashPair(left, right));
    }
    layer = next;
  }
  return layer[0]!;
}

export function sessionRootFrom(
  voteRoot: `0x${string}`,
  move: string,
  p0: number,
  p1: number,
  sessionId: string,
): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "string" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "string" },
      ],
      [
        voteRoot,
        move,
        BigInt(Math.round(p0 * 1e8)),
        BigInt(Math.round(p1 * 1e8)),
        sessionId,
      ],
    ),
  );
}

/** Recompute the session root purely from the raw vote inputs. */
export function recomputeSessionRoot(v: SessionVerification): {
  voteRoot: `0x${string}`;
  sessionRoot: `0x${string}`;
} {
  const leaves = v.votes.map((vote) =>
    voteLeaf(v.sessionId, vote.agentName, vote.way, vote.sizeUsd, vote.rationale),
  );
  const voteRoot = merkleRoot(leaves);
  const sessionRoot = sessionRootFrom(
    voteRoot,
    v.priceMove,
    v.priceP0,
    v.priceP1,
    v.sessionId,
  );
  return { voteRoot, sessionRoot };
}

/** Fold a sorted-pair Merkle proof from a leaf up to the root. */
export function foldProof(
  leaf: `0x${string}`,
  proof: `0x${string}`[],
): `0x${string}` {
  return proof.reduce((acc, sibling) => hashPair(acc, sibling), leaf);
}

const CHAINS = {
  5000: mantle,
  5003: mantleSepoliaTestnet,
} as const;

const ROOTS_ABI = [
  {
    type: "function",
    name: "roots",
    stateMutability: "view",
    inputs: [{ name: "", type: "bytes32" }],
    outputs: [{ name: "", type: "bytes32" }],
  },
] as const;

/** Read the anchored root for an hour bucket directly from Mantle. */
export async function readOnchainRoot(args: {
  contractAddress: string;
  chainId: number;
  hourBucket: string;
}): Promise<`0x${string}`> {
  const chain = CHAINS[args.chainId as keyof typeof CHAINS] ?? mantle;
  const rpcUrl = process.env.NEXT_PUBLIC_MANTLE_RPC_URL;
  const client: PublicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });
  const key = keccak256(toBytes(args.hourBucket));
  return client.readContract({
    address: args.contractAddress as `0x${string}`,
    abi: ROOTS_ABI,
    functionName: "roots",
    args: [key],
  });
}

const ZERO_ROOT =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

export function isZeroRoot(root: string): boolean {
  return root.toLowerCase() === ZERO_ROOT;
}

export function eqHex(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

export function shortHex(hex: string | null | undefined, lead = 10, tail = 8): string {
  if (!hex) return "—";
  if (hex.length <= lead + tail + 1) return hex;
  return `${hex.slice(0, lead)}…${hex.slice(-tail)}`;
}
