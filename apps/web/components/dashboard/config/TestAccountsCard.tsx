"use client";

import { useActionState, useState } from "react";
import { configureActivePentestAction } from "@/app/dashboard/settings/actions";
import { CardShell } from "./CardShell";
import { UsersIcon, ChevronDownIcon, CopyIcon, CheckIcon } from "./icons";

export interface TestAccountsCardProps {
  projectId: string;
  hasAccountA: boolean;
  hasAccountB: boolean;
  testAccountAEmail: string | null;
  testAccountBEmail: string | null;
}

/**
 * Step 2 — Test accounts. The user-facing HEART of the configuration: this
 * is what most users spend time on and what most users are unsure about. Two
 * design principles here:
 *
 * 1. Prominent guidance. "Why does Kelp need this?" is inline, plain-English,
 *    always visible — not buried in a `<details>`.
 * 2. Symmetric A/B input. Identical two-column layout with matching states
 *    ("Stored ✓" badges, placeholder that shows "•••••• (stored — leave
 *    blank to keep)").
 *
 * Two accounts are required because Kelp probes cross-account access
 * (accountA tries to read accountB's data). One account cannot expose that
 * class of bugs.
 */
export function TestAccountsCard(props: TestAccountsCardProps) {
  const [state, action, pending] = useActionState<
    { ok: boolean; message: string } | null,
    FormData
  >(configureActivePentestAction, null);

  const done = props.hasAccountA && props.hasAccountB;
  const partial = props.hasAccountA !== props.hasAccountB;
  const status = done ? "done" : "needed";

  return (
    <CardShell
      id="test-accounts"
      step={2}
      icon={<UsersIcon />}
      title="Two test accounts"
      description={
        done
          ? "Kelp will sign in as these two accounts and probe safely — never touching real user data."
          : "Kelp signs in as two different users on your app and tries to peek at each other's data. This is how it catches broken access-control bugs."
      }
      status={status}
      statusLabel={done ? "Ready" : partial ? "One left" : "Needed"}
    >
      <form action={action} className="space-y-5">
        <input type="hidden" name="projectId" value={props.projectId} />

        <WhyExplainer done={done} />

        <div className="grid gap-4 sm:grid-cols-2">
          <AccountFieldset
            letter="A"
            stored={props.hasAccountA}
            storedEmail={props.testAccountAEmail}
            emailName="accountAEmail"
            passwordName="accountAPassword"
          />
          <AccountFieldset
            letter="B"
            stored={props.hasAccountB}
            storedEmail={props.testAccountBEmail}
            emailName="accountBEmail"
            passwordName="accountBPassword"
          />
        </div>

        <HowToGuide />

        <div className="flex items-center justify-between pt-1">
          <p className="text-[12px] text-fog-500">
            Passwords are encrypted at rest. Leave a password blank to keep the stored one.
          </p>
          <button
            type="submit"
            disabled={pending}
            className="shrink-0 whitespace-nowrap rounded-lg bg-gradient-to-r from-aqua-400 to-aqua-600 px-4 py-2 text-sm font-medium text-ink-950 shadow-sm shadow-aqua-500/10 transition-all disabled:opacity-40"
          >
            {pending ? "Saving…" : "Save test accounts"}
          </button>
        </div>

        {state && (
          <p
            className={`rounded-lg border px-3 py-2 text-[12.5px] ${
              state.ok
                ? "border-aqua-600/30 bg-aqua-500/[0.06] text-aqua-300"
                : "border-crit/30 bg-crit/[0.06] text-crit"
            }`}
          >
            {state.message}
          </p>
        )}
      </form>
    </CardShell>
  );
}

/** Concise "why we need this" block — always visible, not hidden in a details. */
function WhyExplainer({ done }: { done: boolean }) {
  if (done) return null;
  return (
    <div className="rounded-xl border border-line/60 bg-ink-950/40 p-4">
      <div className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-fog-500">
        Why we need two
      </div>
      <ul className="mt-2 space-y-1.5 text-[13px] leading-relaxed text-fog-300">
        <li className="flex gap-2.5">
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-fog-500" />
          <span>
            Kelp signs in as <b>Account A</b> and tries to reach <b>Account B</b>'s data —
            orders, profile, private tables.
          </span>
        </li>
        <li className="flex gap-2.5">
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-fog-500" />
          <span>If anything leaks across, Kelp flags it as a broken-access-control bug.</span>
        </li>
        <li className="flex gap-2.5">
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-fog-500" />
          <span>
            Accounts stay untouched — Kelp only <span className="text-fog-100">reads</span>,
            never writes to a real account's records.
          </span>
        </li>
      </ul>
    </div>
  );
}

/** One column for A or B. Matches the visual language of the whole form. */
function AccountFieldset({
  letter,
  stored,
  storedEmail,
  emailName,
  passwordName,
}: {
  letter: "A" | "B";
  stored: boolean;
  storedEmail: string | null;
  emailName: string;
  passwordName: string;
}) {
  return (
    <fieldset
      className={`rounded-xl border p-4 transition-colors ${
        stored ? "border-aqua-600/25 bg-aqua-500/[0.03]" : "border-line/60 bg-ink-950/40"
      }`}
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold ${
              stored ? "bg-aqua-500/20 text-aqua-300" : "bg-ink-800 text-fog-400"
            }`}
          >
            {letter}
          </span>
          <span className="text-[12.5px] font-medium text-fog-200">Account {letter}</span>
        </div>
        {stored && (
          <span className="inline-flex items-center gap-1 rounded-full bg-aqua-500/12 px-2 py-0.5 text-[10.5px] font-medium text-aqua-300">
            <CheckIcon className="h-3 w-3" />
            Stored
          </span>
        )}
      </div>

      <div className="space-y-2.5">
        <div>
          <label
            className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-fog-500"
            htmlFor={`${emailName}-input`}
          >
            Email
          </label>
          <input
            id={`${emailName}-input`}
            name={emailName}
            type="email"
            placeholder={letter === "A" ? "alice@yourapp.dev" : "bob@yourapp.dev"}
            defaultValue={storedEmail ?? ""}
            className="w-full rounded-lg border border-line bg-ink-950/60 px-3 py-2 text-sm text-fog-100 outline-none transition-colors placeholder:text-fog-600 focus:border-aqua-600/60"
          />
        </div>
        <div>
          <label
            className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-fog-500"
            htmlFor={`${passwordName}-input`}
          >
            Password
          </label>
          <input
            id={`${passwordName}-input`}
            name={passwordName}
            type="password"
            placeholder={stored ? "•••••• (leave blank to keep)" : "at least 8 characters"}
            className="w-full rounded-lg border border-line bg-ink-950/60 px-3 py-2 text-sm text-fog-100 outline-none transition-colors placeholder:text-fog-600 focus:border-aqua-600/60"
          />
        </div>
      </div>
    </fieldset>
  );
}

/**
 * How-to guide — collapsed by default so it doesn't wall of text the user,
 * but PROMINENT (styled button, clear label) so nobody misses it.
 */
function HowToGuide() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-line/60 bg-ink-900/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-fog-500/10 px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-wider text-fog-400">
            How to
          </span>
          <span className="text-[13px] font-medium text-fog-100">
            How do I create two test accounts?
          </span>
        </div>
        <ChevronDownIcon
          className={`h-4 w-4 text-fog-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="space-y-4 border-t border-line/60 px-4 pb-4 pt-4 text-[13px] leading-relaxed text-fog-300">
          <div>
            <div className="mb-1.5 text-[10.5px] font-medium uppercase tracking-[0.14em] text-fog-500">
              Fastest — go through your own signup flow
            </div>
            <ol className="space-y-1.5 pl-4">
              <li className="list-decimal">
                Open your deployed app (or dev site) and sign up as{" "}
                <code className="rounded bg-ink-800/80 px-1 font-mono text-[11.5px] text-fog-200">
                  alice@yourapp.dev
                </code>{" "}
                — anything works, no need to be a real inbox.
              </li>
              <li className="list-decimal">
                Sign up again as{" "}
                <code className="rounded bg-ink-800/80 px-1 font-mono text-[11.5px] text-fog-200">
                  bob@yourapp.dev
                </code>{" "}
                (an incognito window helps).
              </li>
              <li className="list-decimal">
                Give each user something to own — create a post, place an order, whatever
                your app does. Kelp probes access to real data, so accounts with data
                surface more bugs.
              </li>
              <li className="list-decimal">Paste both credentials above.</li>
            </ol>
          </div>

          <div className="rounded-lg border border-line/50 bg-ink-950/40 p-3">
            <div className="mb-1.5 flex items-center justify-between">
              <div className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-fog-500">
                Or ask your AI coding tool
              </div>
              <CopyPromptButton
                prompt={
                  "Create two test accounts in my app for security testing.\n\n" +
                  "For each: sign up via my app's normal signup flow with these emails:\n" +
                  "  - alice@yourapp.dev\n  - bob@yourapp.dev\n\n" +
                  "Then, for each account, create at least one owned resource " +
                  "(post, order, profile row) so the pen test has real data to probe. " +
                  "Do NOT bypass email confirmation on any real production users — " +
                  "these are throwaway test accounts."
                }
              />
            </div>
            <p className="text-[12.5px] text-fog-400">
              Paste the prompt into Lovable, Bolt, Cursor, or v0. Your AI tool will handle
              the seed script for you.
            </p>
          </div>

          <div className="rounded-lg border-l-2 border-line pl-3">
            <p className="text-[12px] text-fog-500">
              <b className="text-fog-300">Do not paste real user credentials.</b> Kelp
              probes read paths and could touch data owned by these accounts. Use throwaway
              accounts you create just for testing.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/** Small copy-to-clipboard button used in the how-to guide. Feedback state. */
function CopyPromptButton({ prompt }: { prompt: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(prompt);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard blocked — silent no-op */
        }
      }}
      className="inline-flex items-center gap-1.5 rounded-md border border-line/60 px-2.5 py-1 text-[11px] font-medium text-fog-300 transition-colors hover:border-line hover:text-fog-100"
    >
      {copied ? (
        <>
          <CheckIcon className="h-3 w-3 text-aqua-300" />
          Copied
        </>
      ) : (
        <>
          <CopyIcon className="h-3.5 w-3.5" />
          Copy prompt
        </>
      )}
    </button>
  );
}
