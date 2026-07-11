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
        <div className="mb-6 border-l border-[color:var(--color-hair-strong)] py-1 pl-5">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
            § What you're agreeing to, in one line
          </div>
          <p className="mt-3 text-[13px] leading-[1.7] text-[color:var(--color-paper-300)]">
            You own (or have written permission for) this project, and you authorize Kelp to send
            simulated attack traffic to it. Full text below — take a minute to skim it.
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
