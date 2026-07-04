// Tiny code-preview panel that lives inside each "what we check" card. Each
// preview is hand-hardcoded per class — a mock finding shown as syntax-hinted
// code, with the incriminating line highlighted. On hover the card lifts and
// the highlight pulses; when the card enters view a subtle top-to-bottom
// gradient sweeps across the code once (via the .scan-sweep animation).

import type { ReactNode } from "react";

interface CheckPreviewProps {
  tag: "RLS" | "Secrets" | "BOLA";
}

export function CheckPreview({ tag }: CheckPreviewProps) {
  return (
    <div className="relative mt-5 overflow-hidden rounded-lg border border-line/70 bg-ink-950/60 font-mono text-[11px] leading-relaxed">
      {/* A single restrained sweep across the panel when it enters view. The
          animation runs once, then holds — no distracting loop. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-8 -translate-y-full bg-gradient-to-b from-aqua-500/15 via-aqua-500/5 to-transparent group-hover:animate-scanline"
      />
      <div className="px-3 py-2.5">
        {tag === "RLS" && <RlsPreview />}
        {tag === "Secrets" && <SecretsPreview />}
        {tag === "BOLA" && <BolaPreview />}
      </div>
    </div>
  );
}

function Line({ n, children, hit }: { n: number; children: ReactNode; hit?: boolean }) {
  return (
    <div
      className={`-mx-3 flex gap-3 px-3 ${
        hit ? "bg-[color:var(--color-crit)]/[0.08] text-fog-100" : ""
      }`}
    >
      <span className="w-4 select-none text-right text-fog-500">{n}</span>
      <span className="min-w-0 truncate">{children}</span>
    </div>
  );
}

const K = ({ children }: { children: ReactNode }) => (
  <span className="text-violet-400">{children}</span>
);
const S = ({ children }: { children: ReactNode }) => (
  <span className="text-aqua-400">{children}</span>
);
const D = ({ children }: { children: ReactNode }) => (
  <span className="text-fog-500">{children}</span>
);
const BAD = ({ children }: { children: ReactNode }) => (
  <span className="text-[color:var(--color-crit)]">{children}</span>
);

function RlsPreview() {
  return (
    <>
      <Line n={1}>
        <D>-- profiles table</D>
      </Line>
      <Line n={2}>
        <K>alter table</K> profiles <K>enable row level security</K>;
      </Line>
      <Line n={3} hit>
        <BAD>! no policies defined</BAD>
      </Line>
      <Line n={4}>
        <D>-- effect: 0 rows visible to anyone</D>
      </Line>
    </>
  );
}

function SecretsPreview() {
  return (
    <>
      <Line n={11}>
        <D>// src/lib/stripe.ts</D>
      </Line>
      <Line n={12} hit>
        <K>const</K> stripe = <K>new</K> Stripe(<S>&quot;sk_live_51H8xQh2eZv…&quot;</S>);
      </Line>
      <Line n={13}>
        <BAD>↳ ships to the browser bundle</BAD>
      </Line>
    </>
  );
}

function BolaPreview() {
  return (
    <>
      <Line n={1}>
        <span className="text-fog-400">GET /api/orders/</span>
        <S>1234</S>
        <D> → 200 (own)</D>
      </Line>
      <Line n={2} hit>
        <span className="text-fog-400">GET /api/orders/</span>
        <S>1235</S>
        <BAD> → 200</BAD>
        <D> (someone else&apos;s)</D>
      </Line>
      <Line n={3}>
        <BAD>↳ cross-account read confirmed</BAD>
      </Line>
    </>
  );
}
