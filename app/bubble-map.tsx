"use client";

import { useEffect, useRef, useState } from "react";
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
} from "d3-force";
import { radiusFor, roomLinks, type Agent, type Link, type Way } from "@/lib/feed";
import { fetchFloor, type FloorMessage, type FloorRoom } from "@/lib/floor";

const ACCENT = [255, 162, 24] as const;
const WHITE = [255, 255, 255] as const;
const LONG_COLOR = [52, 211, 153] as const; // green — long position
const SHORT_COLOR = [248, 113, 113] as const; // red — short position
const GRAY = [120, 140, 165] as const; // inactive / no live position
const rgba = (c: readonly number[], a: number) =>
  `rgba(${c[0]},${c[1]},${c[2]},${a})`;

/** Color a live agent by its current stance: long=green, short=red, else accent. */
function stanceColor(way: Way | null): readonly number[] {
  if (way === "LONG") return LONG_COLOR;
  if (way === "SHORT") return SHORT_COLOR;
  return ACCENT;
}

const POLL_MS = 4000;

interface Pulse {
  source: Agent;
  target: Agent;
  progress: number;
  speed: number;
}

interface HoverState {
  agent: Agent;
  x: number;
  y: number;
}

interface Stats {
  agents: number;
  rooms: number;
  volumeUsd: number;
}

const WAY_LABEL: Record<string, string> = {
  LONG: "long",
  SHORT: "short",
  NOTR: "no trade",
};

function formatUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}

export default function BubbleMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [status, setStatus] = useState<"loading" | "live" | "offline">(
    "loading",
  );

  const hoverRef = useRef<HoverState | null>(null);
  useEffect(() => {
    hoverRef.current = hover;
  }, [hover]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const poppins =
      getComputedStyle(container).getPropertyValue("--font-poppins").trim() ||
      "sans-serif";
    const font = (weight: number, size: number) =>
      `${weight} ${size}px ${poppins}`;

    // live state, mutated across polls so node positions survive updates
    let agents: Agent[] = [];
    // Inactive (top-100 by score) background nodes: scattered, gray, static —
    // kept out of the force sim so they don't perturb the live clusters.
    let ambient: Agent[] = [];
    let links: Link[] = [];
    let rooms: FloorRoom[] = [];
    // Only genuinely new messages (ts beyond what we've already seen) become
    // pulses. We never replay history, so the floor is quiet when no one talks.
    let lastSeenTs = -1;
    const pending: FloorMessage[] = [];
    const pulses: Pulse[] = [];
    const centers = new Map<string, { x: number; y: number }>();
    const clusterRadius = new Map<string, number>();

    let width = 0;
    let height = 0;
    let dpr = 1;
    // view transform (world -> screen): screen = world * k + offset
    const view = { k: 1, x: 0, y: 0 };
    const toWorld = (sx: number, sy: number) => ({
      x: (sx - view.x) / view.k,
      y: (sy - view.y) / view.k,
    });

    const linkForce = forceLink<Agent, Link>([])
      .id((d) => d.id)
      .distance(72)
      .strength(0.06);

    const sim: Simulation<Agent, Link> = forceSimulation<Agent>([])
      .force("link", linkForce)
      .force("charge", forceManyBody<Agent>().strength(-140).distanceMax(520))
      .force(
        "collide",
        forceCollide<Agent>()
          .radius((d) => radiusFor(d.score) + 10)
          .strength(1),
      )
      .stop();
    sim.alphaTarget(reduceMotion ? 0 : 0.04);

    function computeCenters() {
      const cx = width / 2;
      const cy = height / 2;
      centers.clear();
      if (rooms.length === 0) return;
      if (rooms.length === 1) {
        centers.set(rooms[0].id, { x: cx, y: cy });
        return;
      }
      const rx = Math.min(width * 0.36, 560);
      const ry = Math.min(height * 0.34, 380);
      rooms.forEach((room, i) => {
        const angle = (i / rooms.length) * Math.PI * 2 - Math.PI / 2;
        centers.set(room.id, {
          x: cx + Math.cos(angle) * rx,
          y: cy + Math.sin(angle) * ry,
        });
      });
    }

    function bindClusterForces() {
      sim
        .force(
          "x",
          forceX<Agent>((d) => centers.get(d.room)?.x ?? width / 2).strength(
            0.06,
          ),
        )
        .force(
          "y",
          forceY<Agent>((d) => centers.get(d.room)?.y ?? height / 2).strength(
            0.06,
          ),
        );
    }

    // Each room is a translucent boundary circle sized to hold its members. The
    // radius is derived from the members' collision footprints so it grows with
    // population; agents are then clamped inside it (see constrainToCluster).
    function computeClusterRadii() {
      clusterRadius.clear();
      const byRoom = new Map<string, Agent[]>();
      for (const a of agents) {
        (byRoom.get(a.room) ?? byRoom.set(a.room, []).get(a.room)!).push(a);
      }
      for (const [room, members] of byRoom) {
        let sumR2 = 0;
        for (const m of members) {
          const r = radiusFor(m.score) + 10;
          sumR2 += r * r;
        }
        const r = Math.sqrt(sumR2 / 0.5) + 20;
        clusterRadius.set(room, Math.max(r, 75));
      }
    }

    // Keep an agent within its room's circle. The fixed drag point is clamped
    // too, so a dragged bubble cannot be pulled past the boundary either.
    function constrainToCluster(a: Agent) {
      const c = centers.get(a.room);
      const cr = clusterRadius.get(a.room);
      if (!c || !cr) return;
      const maxD = cr - radiusFor(a.score) - 5;
      if (maxD <= 0) return;
      const dx = (a.x ?? 0) - c.x;
      const dy = (a.y ?? 0) - c.y;
      const d = Math.hypot(dx, dy);
      if (d <= maxD) return;
      const s = maxD / d;
      a.x = c.x + dx * s;
      a.y = c.y + dy * s;
      if (a.fx != null) a.fx = a.x;
      if (a.fy != null) a.fy = a.y;
      if (a.vx != null) a.vx *= 0.4;
      if (a.vy != null) a.vy *= 0.4;
    }

    function layout() {
      const rect = container!.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas!.width = Math.round(width * dpr);
      canvas!.height = Math.round(height * dpr);
      canvas!.style.width = `${width}px`;
      canvas!.style.height = `${height}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      computeCenters();
      bindClusterForces();
      sim.alpha(0.5);
    }
    layout();

    const ro = new ResizeObserver(layout);
    ro.observe(container);

    // Inactive (ambient) nodes must sit OUTSIDE every room circle, so they read
    // as "not in a room". These helpers test/avoid the room cluster discs.
    function insideAnyCluster(px: number, py: number, margin: number): boolean {
      for (const [room, c] of centers) {
        const cr = (clusterRadius.get(room) ?? 0) + margin;
        const dx = px - c.x;
        const dy = py - c.y;
        if (dx * dx + dy * dy < cr * cr) return true;
      }
      return false;
    }

    function scatterOutside(
      w: number,
      h: number,
      nodeR: number,
    ): { x: number; y: number } {
      const margin = nodeR + 16; // keep the whole bubble clear of the circle
      for (let i = 0; i < 60; i++) {
        const x = Math.random() * w;
        const y = Math.random() * h;
        if (!insideAnyCluster(x, y, margin)) return { x, y };
      }
      // Fallback: push a random point radially out of every cluster it violates.
      let x = Math.random() * w;
      let y = Math.random() * h;
      for (const [room, c] of centers) {
        const cr = (clusterRadius.get(room) ?? 0) + margin;
        const dx = x - c.x;
        const dy = y - c.y;
        const d = Math.hypot(dx, dy) || 1;
        if (d < cr) {
          x = c.x + (dx / d) * cr;
          y = c.y + (dy / d) * cr;
        }
      }
      return { x, y };
    }

    // ---- reconcile a /floor snapshot into the live simulation ----
    function reconcile(snap: Awaited<ReturnType<typeof fetchFloor>>) {
      rooms = snap.rooms;
      computeCenters();

      // Live agents (in a room) drive the clustered simulation; inactive ones
      // become ambient background scatter.
      const liveFa = snap.agents.filter((a) => a.live && a.room);
      const inactiveFa = snap.agents.filter((a) => !a.live || !a.room);

      const prev = new Map(agents.map((a) => [a.id, a]));
      const next: Agent[] = [];
      for (const fa of liveFa) {
        // The node sends scores on a [0,100] scale; the geometry/alpha math here
        // works in [0,1], so normalize at ingestion.
        const score01 = fa.score / 100;
        const existing = prev.get(fa.id);
        if (existing) {
          existing.score = score01;
          existing.way = fa.way;
          existing.live = fa.live;
          next.push(existing);
        } else {
          const c = centers.get(fa.room);
          next.push({
            id: fa.id,
            name: fa.name,
            room: fa.room,
            score: score01,
            way: fa.way,
            live: fa.live,
            lastActive: 0,
            x: (c?.x ?? width / 2) + (Math.random() - 0.5) * 50,
            y: (c?.y ?? height / 2) + (Math.random() - 0.5) * 50,
          });
        }
      }
      agents = next;
      computeClusterRadii();

      // Inactive agents: scatter messily across the whole map. Positions are
      // preserved across polls (by id) so they don't jump on every refresh.
      const prevAmbient = new Map(ambient.map((a) => [a.id, a]));
      const w = width || 1000;
      const h = height || 700;
      ambient = inactiveFa.map((fa) => {
        const score01 = fa.score / 100;
        const r = radiusFor(score01);
        const existing = prevAmbient.get(fa.id);
        if (existing) {
          existing.score = score01;
          // If a room cluster grew over it (or it spawned inside one), relocate
          // it back outside the circles.
          if (insideAnyCluster(existing.x ?? 0, existing.y ?? 0, r + 16)) {
            const p = scatterOutside(w, h, r);
            existing.x = p.x;
            existing.y = p.y;
          }
          return existing;
        }
        const p = scatterOutside(w, h, r);
        return {
          id: fa.id,
          name: fa.name,
          room: "",
          score: score01,
          way: null,
          live: false,
          ambient: true,
          lastActive: 0,
          x: p.x,
          y: p.y,
        };
      });

      const byRoom = new Map<string, Agent[]>();
      for (const a of agents) {
        (byRoom.get(a.room) ?? byRoom.set(a.room, []).get(a.room)!).push(a);
      }
      links = [];
      for (const members of byRoom.values()) links.push(...roomLinks(members));

      if (lastSeenTs < 0) {
        // first snapshot establishes the baseline; history is not animated
        lastSeenTs = snap.messages.reduce((m, x) => Math.max(m, x.ts), 0);
      } else {
        const fresh = snap.messages
          .filter((m) => m.ts > lastSeenTs)
          .sort((a, b) => a.ts - b.ts);
        for (const m of fresh) pending.push(m);
        if (fresh.length) lastSeenTs = fresh[fresh.length - 1].ts;
        // avoid backlog if a burst arrives between polls
        if (pending.length > 24) pending.splice(0, pending.length - 24);
      }

      sim.nodes(agents);
      linkForce.links(links);
      bindClusterForces();
      sim.alpha(0.6);

      setStats(snap.stats);
      setStatus("live");
    }

    let stopped = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    async function poll() {
      try {
        const snap = await fetchFloor();
        if (!stopped) reconcile(snap);
      } catch {
        if (!stopped) setStatus((s) => (s === "live" ? "live" : "offline"));
      } finally {
        if (!stopped) pollTimer = setTimeout(poll, POLL_MS);
      }
    }
    poll();

    // ---- pointer interaction: hover, drag bubbles, scroll-zoom, pan ----
    let dragging: Agent | null = null;
    let panning = false;
    let panStartX = 0;
    let panStartY = 0;
    let panViewX = 0;
    let panViewY = 0;

    // hit-test in world coordinates
    function agentAt(wx: number, wy: number): Agent | null {
      let best: Agent | null = null;
      let bestDist = Infinity;
      for (const a of agents) {
        const dx = (a.x ?? 0) - wx;
        const dy = (a.y ?? 0) - wy;
        const d2 = dx * dx + dy * dy;
        const r = radiusFor(a.score) + 6;
        if (d2 < r * r && d2 < bestDist) {
          best = a;
          bestDist = d2;
        }
      }
      return best;
    }

    function toLocal(e: { clientX: number; clientY: number }) {
      const rect = canvas!.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function onMove(e: PointerEvent) {
      const { x, y } = toLocal(e);
      if (panning) {
        view.x = panViewX + (x - panStartX);
        view.y = panViewY + (y - panStartY);
        return;
      }
      const w = toWorld(x, y);
      if (dragging) {
        dragging.fx = w.x;
        dragging.fy = w.y;
        return;
      }
      const a = agentAt(w.x, w.y);
      canvas!.style.cursor = a ? "grab" : "grab";
      setHover(
        a
          ? {
              agent: a,
              x: (a.x ?? 0) * view.k + view.x,
              y: (a.y ?? 0) * view.k + view.y,
            }
          : null,
      );
    }

    function onDown(e: PointerEvent) {
      const { x, y } = toLocal(e);
      const w = toWorld(x, y);
      const a = agentAt(w.x, w.y);
      canvas!.setPointerCapture(e.pointerId);
      if (a) {
        dragging = a;
        a.fx = w.x;
        a.fy = w.y;
        canvas!.style.cursor = "grabbing";
        sim.alphaTarget(0.25);
      } else {
        panning = true;
        panStartX = x;
        panStartY = y;
        panViewX = view.x;
        panViewY = view.y;
        canvas!.style.cursor = "grabbing";
        setHover(null);
      }
    }

    function onUp(e: PointerEvent) {
      if (dragging) {
        dragging.fx = null;
        dragging.fy = null;
        dragging = null;
        sim.alphaTarget(reduceMotion ? 0 : 0.04);
      }
      panning = false;
      canvas!.style.cursor = "grab";
      try {
        canvas!.releasePointerCapture(e.pointerId);
      } catch {
        // pointer was not captured
      }
    }

    function onLeave() {
      if (!dragging && !panning) setHover(null);
    }

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const { x, y } = toLocal(e);
      const factor = Math.exp(-e.deltaY * 0.0015);
      const k = Math.max(0.35, Math.min(6, view.k * factor));
      // keep the world point under the cursor fixed while zooming
      const wx = (x - view.x) / view.k;
      const wy = (y - view.y) / view.k;
      view.x = x - wx * k;
      view.y = y - wy * k;
      view.k = k;
    }

    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    // ---- turn a single real, newly-arrived message into one pulse ----
    function emitPending(now: number) {
      const m = pending.shift();
      if (!m) return;
      const src = agents.find((a) => a.id === `${m.from}@${m.room}`);
      if (!src) return;
      const peers = agents.filter((a) => a.room === m.room && a !== src);
      if (peers.length === 0) return;
      const dst = peers[Math.floor(Math.random() * peers.length)];
      src.lastActive = now;
      pulses.push({
        source: src,
        target: dst,
        progress: 0,
        speed: 0.8 + Math.random() * 0.5,
      });
    }

    function draw(now: number) {
      // background fills the whole viewport in screen space (not zoomed)
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.clearRect(0, 0, width, height);
      const bg = ctx!.createRadialGradient(
        width / 2,
        height / 2,
        0,
        width / 2,
        height / 2,
        Math.max(width, height) * 0.7,
      );
      bg.addColorStop(0, "#06305c");
      bg.addColorStop(1, "#001428");
      ctx!.fillStyle = bg;
      ctx!.fillRect(0, 0, width, height);

      // scene is drawn in world space through the zoom/pan transform
      ctx!.setTransform(dpr * view.k, 0, 0, dpr * view.k, dpr * view.x, dpr * view.y);

      const hoveredRoom = hoverRef.current?.agent.room ?? null;

      ctx!.textAlign = "center";
      ctx!.textBaseline = "middle";

      // Inactive agents: full-size MUTED GRAY bubbles, scattered outside the room
      // circles (drawn first so live clusters sit on top). Same shape as live
      // nodes — sized by excellence score — just gray and dimmed.
      for (const a of ambient) {
        const x = a.x ?? 0;
        const y = a.y ?? 0;
        const r = radiusFor(a.score);
        const dim = 0.6;

        ctx!.beginPath();
        ctx!.arc(x, y, r, 0, Math.PI * 2);
        ctx!.fillStyle = rgba(GRAY, 0.8 * dim);
        ctx!.fill();

        ctx!.lineWidth = 2;
        ctx!.strokeStyle = rgba(GRAY, (0.4 + a.score * 0.55) * dim);
        ctx!.beginPath();
        ctx!.arc(x, y, r + 2.5, 0, Math.PI * 2);
        ctx!.stroke();

        ctx!.fillStyle = rgba([0, 20, 40], 0.55 * dim);
        ctx!.beginPath();
        ctx!.arc(x, y, Math.max(2, r * 0.22), 0, Math.PI * 2);
        ctx!.fill();

        ctx!.font = font(500, 11);
        ctx!.fillStyle = rgba(WHITE, 0.45);
        ctx!.fillText(a.name, x, y + r + 12);
      }
      // Room clusters render as translucent, non-interactive circles. They are
      // never hit-tested in agentAt, so the mouse passes through them; they only
      // visually contain their members, who are confined within the boundary.
      for (const room of rooms) {
        const c = centers.get(room.id);
        if (!c) continue;
        const cr = clusterRadius.get(room.id) ?? 75;
        const active = hoveredRoom === room.id;
        ctx!.beginPath();
        ctx!.arc(c.x, c.y, cr, 0, Math.PI * 2);
        ctx!.fillStyle = rgba(WHITE, active ? 0.06 : 0.035);
        ctx!.fill();
        ctx!.lineWidth = 1.5;
        ctx!.strokeStyle = rgba(WHITE, active ? 0.22 : 0.1);
        ctx!.stroke();
      }

      ctx!.lineWidth = 1;
      for (const l of links) {
        const s = l.source as Agent;
        const t = l.target as Agent;
        const active = hoveredRoom && l.room === hoveredRoom;
        ctx!.strokeStyle = active ? rgba(ACCENT, 0.28) : rgba(WHITE, 0.07);
        ctx!.beginPath();
        ctx!.moveTo(s.x ?? 0, s.y ?? 0);
        ctx!.lineTo(t.x ?? 0, t.y ?? 0);
        ctx!.stroke();
      }

      for (const p of pulses) {
        const sx = p.source.x ?? 0;
        const sy = p.source.y ?? 0;
        const tx = p.target.x ?? 0;
        const ty = p.target.y ?? 0;
        const x = sx + (tx - sx) * p.progress;
        const y = sy + (ty - sy) * p.progress;
        const glow = ctx!.createRadialGradient(x, y, 0, x, y, 7);
        glow.addColorStop(0, rgba(ACCENT, 0.9));
        glow.addColorStop(1, rgba(ACCENT, 0));
        ctx!.fillStyle = glow;
        ctx!.beginPath();
        ctx!.arc(x, y, 7, 0, Math.PI * 2);
        ctx!.fill();
        ctx!.fillStyle = rgba(WHITE, 0.95);
        ctx!.beginPath();
        ctx!.arc(x, y, 1.6, 0, Math.PI * 2);
        ctx!.fill();
      }

      for (const a of agents) {
        const x = a.x ?? 0;
        const y = a.y ?? 0;
        const r = radiusFor(a.score);
        const heat = Math.max(0, 1 - (now - a.lastActive) / 1600);
        const isHover = hoverRef.current?.agent === a;
        const roomDim = hoveredRoom && a.room !== hoveredRoom ? 0.35 : 1;
        const dim = roomDim * (a.live ? 1 : 0.62);
        // Position-based color: green = long, red = short, accent = in room but
        // no/neutral stance.
        const color = stanceColor(a.way);

        if (heat > 0) {
          const halo = ctx!.createRadialGradient(x, y, r, x, y, r + 16 * heat);
          halo.addColorStop(0, rgba(color, 0.35 * heat));
          halo.addColorStop(1, rgba(color, 0));
          ctx!.fillStyle = halo;
          ctx!.beginPath();
          ctx!.arc(x, y, r + 16 * heat, 0, Math.PI * 2);
          ctx!.fill();
        }

        ctx!.beginPath();
        ctx!.arc(x, y, r, 0, Math.PI * 2);
        ctx!.fillStyle = rgba(color, (0.9 - 0.12 * (1 - heat)) * dim);
        ctx!.fill();

        ctx!.lineWidth = 2;
        ctx!.strokeStyle = rgba(color, (0.4 + a.score * 0.55) * dim);
        ctx!.beginPath();
        ctx!.arc(x, y, r + 2.5, 0, Math.PI * 2);
        ctx!.stroke();

        ctx!.fillStyle = rgba([0, 20, 40], 0.85 * dim);
        ctx!.beginPath();
        if (a.way === "LONG") {
          ctx!.moveTo(x, y - r * 0.45);
          ctx!.lineTo(x - r * 0.4, y + r * 0.3);
          ctx!.lineTo(x + r * 0.4, y + r * 0.3);
        } else if (a.way === "SHORT") {
          ctx!.moveTo(x, y + r * 0.45);
          ctx!.lineTo(x - r * 0.4, y - r * 0.3);
          ctx!.lineTo(x + r * 0.4, y - r * 0.3);
        } else {
          ctx!.arc(x, y, Math.max(2, r * 0.22), 0, Math.PI * 2);
        }
        ctx!.closePath();
        ctx!.fill();

        if (r > 15 || isHover) {
          ctx!.font = font(500, 11);
          ctx!.fillStyle = rgba(WHITE, (isHover ? 0.95 : 0.7) * dim);
          ctx!.fillText(a.name, x, y + r + 12);
        }
      }
    }

    let raf = 0;
    let lastT = performance.now();
    let msgTimer = 0;
    const msgEvery = reduceMotion ? Infinity : 0.95;

    function frame(now: number) {
      const dt = Math.min((now - lastT) / 1000, 0.05);
      lastT = now;

      msgTimer += dt;
      if (msgTimer >= msgEvery) {
        msgTimer = 0;
        if (pending.length) emitPending(now);
      }

      for (let i = pulses.length - 1; i >= 0; i--) {
        pulses[i].progress += pulses[i].speed * dt;
        if (pulses[i].progress >= 1) {
          pulses[i].target.lastActive = now;
          pulses.splice(i, 1);
        }
      }

      sim.tick();
      for (const a of agents) constrainToCluster(a);
      draw(now);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return () => {
      stopped = true;
      if (pollTimer) clearTimeout(pollTimer);
      cancelAnimationFrame(raf);
      ro.disconnect();
      sim.stop();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, []);

  return (
    <div ref={containerRef} className="absolute inset-0">
      <canvas ref={canvasRef} className="block h-full w-full touch-none" />

      {hover && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border border-white/10 bg-navy-deep/85 px-3 py-2 text-xs leading-tight shadow-lg backdrop-blur-sm"
          style={{ left: hover.x, top: hover.y - 18 }}
        >
          <div className="font-semibold tracking-wide text-text">
            {hover.agent.name}
            {!hover.agent.live && (
              <span className="ml-1.5 text-[10px] font-normal text-faint">
                idle
              </span>
            )}
          </div>
          <div className="text-muted">{hover.agent.room}</div>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-accent">
              {hover.agent.way ? WAY_LABEL[hover.agent.way] : "—"}
            </span>
            <span className="text-faint">·</span>
            <span className="text-muted">
              excellence {Math.round(hover.agent.score * 10000) / 100}%
            </span>
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute bottom-5 right-6 z-10 text-right font-sans text-[11px] uppercase tracking-[0.18em] text-muted">
        {status === "live" && stats ? (
          <>
            <span className="text-accent">{stats.agents}</span> agents
            <span className="mx-2 text-faint">/</span>
            <span className="text-accent">{stats.rooms}</span> rooms
            <span className="mx-2 text-faint">/</span>
            <span className="text-accent">{formatUsd(stats.volumeUsd)}</span>{" "}
            volume
          </>
        ) : (
          <span className="text-faint">
            {status === "loading" ? "connecting to node…" : "node offline"}
          </span>
        )}
      </div>
    </div>
  );
}
