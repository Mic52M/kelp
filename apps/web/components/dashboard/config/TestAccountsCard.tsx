"use client";

import { useActionState, useState } from "react";
import { configureActivePentestAction } from "@/app/dashboard/settings/actions";
import { buttonClasses } from "@/components/Button";
import { CardShell } from "./CardShell";
import { UsersIcon, ChevronDownIcon, CopyIcon, CheckIcon } from "./icons";

export interface TestAccountsCardProps {
  projectId: string;
  hasAccountA: boolean;
  hasAccountB: boolean;
  testAccountAEmail: string | null;
  testAccountBEmail: string | null;
}

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
      <form action={action} className="space-y-6">
        <input type="hidden" name="projectId" value={props.projectId} />

        <WhyExplainer done={done} />

        <div className="grid gap-6 sm:grid-cols-2">
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

        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[color:var(--color-hair)] pt-5">
          <p className="max-w-md font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--color-paper-500)]">
            Passwords encrypted at rest · leave a password blank to keep the stored one
          </p>
          <button
            type="submit"
            disabled={pending}
            className={buttonClasses("primary", "md", "cta-lift")}
          >
            {pending ? "Saving…" : "Save test accounts"}
          </button>
        </div>

        {state && (
          <p
            className="border-l px-4 py-2.5 font-mono text-[12px] leading-relaxed"
            style={{
              borderColor: state.ok ? "var(--color-signal)" : "var(--color-sev-crit)",
              color: state.ok ? "var(--color-signal)" : "var(--color-sev-crit)",
            }}
          >
            {state.message}
          </p>
        )}
      </form>
    </CardShell>
  );
}

function WhyExplainer({ done }: { done: boolean }) {
  if (done) return null;
  return (
    <div className="border-l border-[color:var(--color-hair-strong)] py-1 pl-5">
      <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
        § Why we need two
      </div>
      <ul className="mt-3 space-y-2 text-[13px] leading-[1.7] text-[color:var(--color-paper-300)]">
        <li className="flex gap-3">
          <span className="mt-[10px] inline-block h-px w-3 shrink-0 bg-[color:var(--color-signal-dim)]" />
          <span>
            Kelp signs in as{" "}
            <span className="text-[color:var(--color-paper-50)]">Account A</span> and tries to reach{" "}
            <span className="text-[color:var(--color-paper-50)]">Account B</span>'s data — orders,
            profile, private tables.
          </span>
        </li>
        <li className="flex gap-3">
          <span className="mt-[10px] inline-block h-px w-3 shrink-0 bg-[color:var(--color-signal-dim)]" />
          <span>If anything leaks across, Kelp flags it as a broken-access-control bug.</span>
        </li>
        <li className="flex gap-3">
          <span className="mt-[10px] inline-block h-px w-3 shrink-0 bg-[color:var(--color-signal-dim)]" />
          <span>
            Accounts stay untouched — Kelp only{" "}
            <span className="text-[color:var(--color-paper-50)]">reads</span>, never writes to a real
            account's records.
          </span>
        </li>
      </ul>
    </div>
  );
}

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
      className="border p-5 transition-colors"
      style={{
        borderColor: stored ? "var(--color-signal-dim)" : "var(--color-hair)",
      }}
    >
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span
            className="flex h-6 w-6 items-center justify-center font-mono text-[11px]"
            style={{
              border: "1px solid",
              borderColor: stored ? "var(--color-signal)" : "var(--color-hair-strong)",
              color: stored ? "var(--color-signal)" : "var(--color-paper-400)",
            }}
          >
            {letter}
          </span>
          <span className="font-display text-[16px] text-[color:var(--color-paper-50)]">
            Account {letter}
          </span>
        </div>
        {stored && (
          <span
            className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em]"
            style={{ color: "var(--color-signal)" }}
          >
            <CheckIcon className="h-3 w-3" />
            Stored
          </span>
        )}
      </div>

      <div className="space-y-4">
        <div>
          <label
            className="mb-2 block font-mono text-[10.5px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]"
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
            className="w-full border-b border-[color:var(--color-hair)] bg-transparent px-0 py-2 font-mono text-[13px] text-[color:var(--color-paper-50)] outline-none transition-colors placeholder:text-[color:var(--color-paper-500)] focus:border-[color:var(--color-signal)]"
          />
        </div>
        <div>
          <label
            className="mb-2 block font-mono text-[10.5px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]"
            htmlFor={`${passwordName}-input`}
          >
            Password
          </label>
          <input
            id={`${passwordName}-input`}
            name={passwordName}
            type="password"
            placeholder={stored ? "•••••• (leave blank to keep)" : "at least 8 characters"}
            className="w-full border-b border-[color:var(--color-hair)] bg-transparent px-0 py-2 font-mono text-[13px] text-[color:var(--color-paper-50)] outline-none transition-colors placeholder:text-[color:var(--color-paper-500)] focus:border-[color:var(--color-signal)]"
          />
        </div>
      </div>
    </fieldset>
  );
}

function HowToGuide() {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-[color:var(--color-hair)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[color:var(--color-ink-850)]"
      >
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
            How-to
          </span>
          <span className="text-[13px] text-[color:var(--color-paper-100)]">
            How do I create two test accounts?
          </span>
        </div>
        <ChevronDownIcon
          className={`h-3.5 w-3.5 text-[color:var(--color-paper-400)] transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="space-y-6 border-t border-[color:var(--color-hair)] px-5 pb-5 pt-5 text-[13px] leading-[1.7] text-[color:var(--color-paper-300)]">
          <div>
            <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
              § Fastest · go through your own signup flow
            </div>
            <ol className="mt-3 space-y-2 pl-4">
              <li className="list-decimal">
                Open your deployed app and sign up as{" "}
                <code className="bg-[color:var(--color-ink-800)] px-1 font-mono text-[11.5px] text-[color:var(--color-paper-100)]">
                  alice@yourapp.dev
                </code>{" "}
                — anything works, no need to be a real inbox.
              </li>
              <li className="list-decimal">
                Sign up again as{" "}
                <code className="bg-[color:var(--color-ink-800)] px-1 font-mono text-[11.5px] text-[color:var(--color-paper-100)]">
                  bob@yourapp.dev
                </code>{" "}
                (an incognito window helps).
              </li>
              <li className="list-decimal">
                Give each user something to own — create a post, place an order, whatever your app
                does. Kelp probes access to real data, so accounts with data surface more bugs.
              </li>
              <li className="list-decimal">Paste both credentials above.</li>
            </ol>
          </div>

          <div className="border border-[color:var(--color-hair)]">
            <div className="flex items-center justify-between border-b border-[color:var(--color-hair)] px-4 py-2.5">
              <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[color:var(--color-paper-400)]">
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
            <p className="px-4 py-3 text-[12.5px] text-[color:var(--color-paper-400)]">
              Paste the prompt into your AI coding tool. It will handle the seed script for you.
            </p>
          </div>

          <div className="border-l border-[color:var(--color-sev-med)] pl-4">
            <p className="text-[12px] text-[color:var(--color-paper-400)]">
              <span className="text-[color:var(--color-paper-100)]">
                Do not paste real user credentials.
              </span>{" "}
              Kelp probes read paths and could touch data owned by these accounts. Use throwaway
              accounts you create just for testing.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

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
          /* clipboard blocked */
        }
      }}
      className="inline-flex items-center gap-1.5 border border-[color:var(--color-hair-strong)] px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.14em] text-[color:var(--color-paper-100)] transition-colors hover:border-[color:var(--color-paper-400)]"
    >
      {copied ? (
        <>
          <CheckIcon
            className="h-3 w-3"
            style={{ color: "var(--color-signal)" } as React.CSSProperties}
          />
          Copied
        </>
      ) : (
        <>
          <CopyIcon className="h-3 w-3" />
          Copy
        </>
      )}
    </button>
  );
}
