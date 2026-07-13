"use client";

// Landing-page free-scan input (#32). Editorial-industrial: mono input, single
// accent CTA, subtle expand for the optional Supabase pair.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { buttonClasses } from "@/components/Button";

type ErrorCode =
  | "invalid_repo_url"
  | "invalid_supabase_url"
  | "invalid_supabase_anon_key"
  | "public_repo_not_found"
  | "rate_limited"
  | "internal"
  | "network"
  | null;

function errorCopy(code: ErrorCode): string | null {
  switch (code) {
    case "invalid_repo_url":
      return "That doesn't look like a github.com/owner/repo URL.";
    case "invalid_supabase_url":
      return "Supabase URL should look like https://xxxxxxxxxxxxxxxxxxxx.supabase.co";
    case "invalid_supabase_anon_key":
      return "That doesn't look like a Supabase anon key (JWT).";
    case "public_repo_not_found":
      return "Kelp couldn't reach that repo. Public repos only — is the URL right?";
    case "rate_limited":
      return "Too many scans in the last hour. Try again in a bit.";
    case "internal":
    case "network":
      return "Something went wrong on our end. Try again in a moment.";
    default:
      return null;
  }
}

export function FreeScanInput() {
  const router = useRouter();
  const [repoUrl, setRepoUrl] = useState("");
  const [expand, setExpand] = useState(false);
  const [supabaseUrl, setSupabaseUrl] = useState("");
  const [anonKey, setAnonKey] = useState("");
  const [error, setError] = useState<ErrorCode>(null);
  const [pending, startTransition] = useTransition();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/free-scan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            repoUrl,
            supabaseUrl: expand && supabaseUrl ? supabaseUrl : undefined,
            supabaseAnonKey: expand && anonKey ? anonKey : undefined,
          }),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: ErrorCode };
          setError(j.error ?? "internal");
          return;
        }
        const j = (await res.json()) as { id: string };
        router.push(`/scan/${j.id}`);
      } catch {
        setError("network");
      }
    });
  }

  const copy = errorCopy(error);

  return (
    <form onSubmit={submit} className="w-full">
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          name="repoUrl"
          type="url"
          required
          autoComplete="off"
          spellCheck={false}
          disabled={pending}
          placeholder="github.com/owner/repo"
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          className="flex-1 border border-[color:var(--color-hair-strong)] bg-[color:var(--color-ink-900)] px-4 py-3 font-mono text-[13.5px] text-[color:var(--color-paper-50)] outline-none transition-colors focus:border-[color:var(--color-signal)] placeholder:text-[color:var(--color-paper-500)] disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={pending}
          className={buttonClasses("primary", "lg", "cta-lift")}
        >
          {pending ? "Starting…" : "Run free scan"}
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-[11.5px] uppercase tracking-[0.14em] text-[color:var(--color-paper-500)]">
        <span>No signup</span>
        <span aria-hidden className="h-1 w-1 bg-[color:var(--color-paper-600)]" />
        <span>Public repos only</span>
        <span aria-hidden className="h-1 w-1 bg-[color:var(--color-paper-600)]" />
        <button
          type="button"
          onClick={() => setExpand((v) => !v)}
          className="text-[color:var(--color-paper-300)] underline-offset-4 transition-colors hover:text-[color:var(--color-paper-50)] hover:underline"
        >
          {expand ? "− Hide Supabase" : "+ Test my Supabase too (optional)"}
        </button>
      </div>

      {expand && (
        <div className="mt-6 grid gap-4 border-t border-[color:var(--color-hair)] pt-6 sm:grid-cols-2">
          <label className="block">
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--color-paper-500)]">
              Supabase URL
            </span>
            <input
              value={supabaseUrl}
              onChange={(e) => setSupabaseUrl(e.target.value)}
              disabled={pending}
              placeholder="https://xxxxxxxxxxxxxxxxxxxx.supabase.co"
              className="mt-2 w-full border border-[color:var(--color-hair)] bg-transparent px-3 py-2 font-mono text-[12.5px] text-[color:var(--color-paper-50)] outline-none focus:border-[color:var(--color-signal)] placeholder:text-[color:var(--color-paper-500)] disabled:opacity-60"
            />
          </label>
          <label className="block">
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--color-paper-500)]">
              Anon key (public, safe)
            </span>
            <input
              value={anonKey}
              onChange={(e) => setAnonKey(e.target.value)}
              disabled={pending}
              placeholder="eyJhbGciOi…"
              className="mt-2 w-full border border-[color:var(--color-hair)] bg-transparent px-3 py-2 font-mono text-[12.5px] text-[color:var(--color-paper-50)] outline-none focus:border-[color:var(--color-signal)] placeholder:text-[color:var(--color-paper-500)] disabled:opacity-60"
            />
          </label>
          <p className="col-span-full font-mono text-[11px] leading-[1.6] text-[color:var(--color-paper-500)]">
            The anon key is public by Supabase design — the same key your app's
            browser bundle already ships. Kelp uses it read-only for schema
            checks. Never store your service-role key here.
          </p>
        </div>
      )}

      {copy && (
        <p className="mt-4 font-mono text-[12px] text-[color:var(--color-signal)]">
          {copy}
        </p>
      )}
    </form>
  );
}
