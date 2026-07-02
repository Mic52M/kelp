import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

/**
 * Request-scoped Supabase client bound to the signed-in user's session (cookies).
 * Queries run as the `authenticated` role, so our RLS policies scope them to the
 * user's orgs automatically.
 */
export async function getServerSupabase() {
  const cookieStore = await cookies();
  return createServerClient(
    env("NEXT_PUBLIC_SUPABASE_URL"),
    env("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(toSet) {
          try {
            for (const { name, value, options } of toSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // called from a Server Component — safe to ignore (middleware refreshes)
          }
        },
      },
    },
  );
}

/**
 * Service-role client that BYPASSES RLS. Server-only, never exposed to the
 * browser. Used for tenant bootstrap and worker-like writes.
 */
export function getAdminSupabase() {
  return createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
