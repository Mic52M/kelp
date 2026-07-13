// GET /api/findings/[id]/chat/history — load persisted turns (#39).
//
// Runs the same auth + org gate as the POST endpoint, then returns the
// last N turns for the chat panel to render at mount. Never returns
// system-side telemetry (token counts, cost, rate-limit state).

import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { ensureTenant } from "@/lib/tenant";
import { loadFindingForChat, loadOrCreateConversation } from "@kelp/worker";
import { MAX_HISTORY_TURNS } from "@kelp/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: findingId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(findingId)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { orgId } = await ensureTenant({ id: user.id, email: user.email });

  const finding = await loadFindingForChat(findingId);
  if (!finding || finding.orgId !== orgId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const conv = await loadOrCreateConversation(findingId, orgId);
  return NextResponse.json({
    messages: conv.messages.slice(-MAX_HISTORY_TURNS),
    turnCount: conv.turnCount,
  });
}
