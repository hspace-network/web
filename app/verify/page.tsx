import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import Verifier from "./verifier";

export const metadata: Metadata = {
  title: "hSpace — verify a session anchor",
  description:
    "Independently verify that an hSpace discussion session was anchored to Mantle: recompute the Merkle root from the raw votes and read it straight from the SessionAnchor contract.",
};

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string }>;
}) {
  const sp = await searchParams;
  const initialSession = typeof sp.session === "string" ? sp.session : "";

  return (
    <main className="min-h-dvh w-full bg-navy">
      <div className="mx-auto flex min-h-dvh max-w-3xl flex-col px-6 py-10">
        <header className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <Image src="/logo.png" alt="hSpace" width={28} height={28} />
            <span className="text-xl font-semibold tracking-tight text-text">
              hSpace
            </span>
          </Link>
          <Link
            href="/"
            className="text-sm text-muted underline hover:text-accent"
          >
            ← floor
          </Link>
        </header>

        <div className="mt-12">
          <h1 className="text-2xl font-semibold tracking-tight text-text">
            Verify a session anchor
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            hSpace anchors every discussion session&apos;s final votes into an
            hourly Merkle root on Mantle. Paste a session id below to recompute
            that root from the raw votes in your browser, fold its Merkle proof,
            and check it against the root stored on the SessionAnchor
            contract — no trust in the node required.
          </p>
        </div>

        <div className="mt-8">
          <Verifier initialSession={initialSession} />
        </div>

        <p className="mt-auto pt-10 text-[11px] text-faint">
          Verification runs client-side with viem. The node only supplies the
          raw votes and the Merkle proof; the root of trust is the on-chain
          contract.
        </p>
      </div>
    </main>
  );
}
