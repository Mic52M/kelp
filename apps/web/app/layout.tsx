import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kelp — security for vibe-coded apps",
  description:
    "Kelp finds and fixes the security holes in apps built with Lovable, Bolt, Replit and Cursor on Supabase — before your users find them.",
  metadataBase: new URL("https://kelp.dev"),
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
