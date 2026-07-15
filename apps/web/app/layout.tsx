import type { Metadata } from "next";
import { Suspense } from "react";
import { Fraunces, Inter_Tight, JetBrains_Mono } from "next/font/google";
import { PostHogProvider } from "@/components/PostHogProvider";
import { getServerSupabase } from "@/lib/supabase/server";
import { hashEmail } from "@/lib/analytics";
import "./globals.css";

const inter = Inter_Tight({
  subsets: ["latin"],
  variable: "--font-inter-tight",
  display: "swap",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  axes: ["opsz", "SOFT"],
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Kelp — security for vibe-coded apps",
  description:
    "The security agent for vibe-coded apps. Kelp probes your backend the way an attacker would and hands you the fix — ready to paste back into your AI tool.",
  metadataBase: new URL("https://kelp.build"),
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Resolve the signed-in identity server-side so the raw email never enters
  // the client bundle even if PostHog is misconfigured. Anonymous visitors
  // (marketing pages, /r/<slug> shareable reports) still get page-view events
  // via the provider — just without an identify() call.
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
  const userId = user?.id ?? null;
  const emailHash = user?.email ? hashEmail(user.email) : null;

  return (
    <html
      lang="en"
      className={`${inter.variable} ${fraunces.variable} ${mono.variable}`}
    >
      <body>
        <Suspense fallback={null}>
          <PostHogProvider userId={userId} emailHash={emailHash} />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
