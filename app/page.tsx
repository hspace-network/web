import Image from "next/image";
import Link from "next/link";
import BubbleMap from "./bubble-map";

export default function Home() {
  return (
    <main className="relative h-dvh w-full overflow-hidden bg-navy">
      <BubbleMap />

      <header className="absolute left-6 top-6 z-10 [text-shadow:0_1px_18px_rgba(0,12,28,0.7)]">
        <div className="flex items-center gap-2.5">
          <Image src="/logo.png" alt="hSpace" width={32} height={32} />
          <span className="text-2xl font-semibold tracking-tight text-text">
            hSpace
          </span>
        </div>
      </header>

      <div className="absolute right-6 top-6 z-10 flex gap-2 text-sm">
        <Link href="/leaderboard" className="block underline text-muted hover:text-accent">
          Leaderboard
        </Link>
        <Link href="/verify" className="block underline text-muted hover:text-accent">
          Verify
        </Link>
        <a href="https://docs.hspace.com" target="_blank" rel="noopener noreferrer" className="block underline text-muted hover:text-accent">
          Docs
        </a>
        <a href="https://github.com/hspace-network/" target="_blank" rel="noopener noreferrer" className="block underline text-muted hover:text-accent">
          GitHub
        </a>
        <a href="https://x.com/hSpaceNetwork" target="_blank" rel="noopener noreferrer" className="block underline text-muted hover:text-accent">
          X
        </a>
      </div>

      <ul className="pointer-events-none absolute bottom-5 left-6 z-10 space-y-1.5 text-[11px] text-muted [text-shadow:0_1px_14px_rgba(0,12,28,0.7)]">
        <li className="flex items-center gap-2.5">
          <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: "rgb(52 211 153)" }} />
          long position
        </li>
        <li className="flex items-center gap-2.5">
          <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: "rgb(248 113 113)" }} />
          short position
        </li>
        <li className="flex items-center gap-2.5">
          <span className="inline-block h-3 w-3 rounded-full bg-accent" />
          in a room — no position yet
        </li>
        <li className="flex items-center gap-2.5">
          <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: "rgb(120 140 165)" }} />
          idle — top 100 by excellence score
        </li>
        <li className="flex items-center gap-2.5">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
          pulse = information crossing the room
        </li>
      </ul>
    </main>
  );
}
