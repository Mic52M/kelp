"use server";

import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { ensureTenant } from "@/lib/tenant";

export type AuthState = { error: string } | null;

/** Sign in or sign up with email + password, then bootstrap the tenant. */
export async function authenticate(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const mode = String(formData.get("mode") ?? "signin");
  if (!email || !password) return { error: "Enter an email and password." };

  const supabase = await getServerSupabase();

  const { data, error } =
    mode === "signup"
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password });

  if (error) return { error: error.message };

  const user = data.user;
  if (user?.email) {
    // signUp with email confirmation disabled returns a session; if confirmation
    // is on, there is no session yet and bootstrap happens on first real login.
    try {
      await ensureTenant({ id: user.id, email: user.email });
    } catch {
      /* bootstrap retried on next authenticated request */
    }
  }

  redirect("/dashboard");
}

export async function signOut() {
  const supabase = await getServerSupabase();
  await supabase.auth.signOut();
  redirect("/login");
}
