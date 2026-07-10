"use client";

import { CardShell } from "./CardShell";
import { ShieldIcon } from "./icons";
import {
  ActiveTestingConsentForm,
  type ProjectConsent,
} from "@/components/dashboard/ActiveTestingConsentForm";

export interface ConsentCardProps {
  consents: ProjectConsent[];
  copy: string;
  version: string;
}

/**
 * Step 3 — Consent. Wrapper card giving the legal block a clean shell + a
 * short human explanation before dropping the user into the (long) consent
 * text. The full form / signed-record UX lives in ActiveTestingConsentForm;
 * we don't duplicate it here.
 */
export function ConsentCard(props: ConsentCardProps) {
  const c = props.consents[0];
  const done = c?.status === "granted";
  const status = done ? "done" : "needed";

  return (
    <CardShell
      id="consent"
      step={3}
      icon={<ShieldIcon />}
      title="Grant consent to test"
      description={
        done
          ? "You've authorized Kelp to run active security probes on this project. Revoke any time."
          : "Kelp only runs live probes against a project after you explicitly authorize it — this is required by our terms and by law."
      }
      status={status}
      statusLabel={done ? "Granted" : "Needed"}
    >
      {!done && (
        <div className="mb-4 rounded-xl border border-line/60 bg-ink-950/40 p-4">
          <div className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-fog-500">
            What you're agreeing to, in one line
          </div>
          <p className="mt-1.5 text-[13px] leading-relaxed text-fog-300">
            You own (or have written permission for) this project, and you authorize Kelp to
            send simulated attack traffic to it. Full text below — take a minute to skim it.
          </p>
        </div>
      )}
      <ActiveTestingConsentForm
        consents={props.consents}
        copy={props.copy}
        version={props.version}
      />
    </CardShell>
  );
}
