// Verifies the Anthropic integration end-to-end against a real finding.
//
//   npm run build
//   node --env-file=.env.local apps/worker/dist/verify-llm.js
//
// Confirms ANTHROPIC_API_KEY works and shows a Claude-written explanation for a
// real finding shape (the kind our RLS scanner produces).

import { createLlmClient, explainFinding, MODELS } from "./llm/anthropic.js";

async function main() {
  const client = createLlmClient();
  console.log(`\nModels — reasoning: ${MODELS.reasoning}, cheap: ${MODELS.cheap}\n`);

  const finding = {
    vulnClass: "rls",
    severity: "critical",
    title: 'Row Level Security is off on "bookings"',
    location: "public.bookings",
    explanation:
      'The table "public.bookings" is reachable through your project\'s API but Row ' +
      "Level Security is disabled. Anyone with your public anon key — which ships in " +
      "your frontend — can read and write every row, including other users' data.",
  };

  console.log(`▶ finding: ${finding.title}\n`);
  const explanation = await explainFinding(client, finding);
  console.log("Claude explanation:\n");
  console.log(explanation);
  console.log();
}

main().catch((e) => {
  console.error("verify-llm failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
