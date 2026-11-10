import { createClient } from "@supabase/supabase-js";
import type { ToolContext } from "@lovable.dev/mcp-js";
import type { Database } from "@/integrations/supabase/types";

type RuntimeGlobals = typeof globalThis & {
  Deno?: { env?: { get?: (name: string) => string | undefined } };
  process?: { env?: Record<string, string | undefined> };
};

function getEnv(name: string) {
  const runtime = globalThis as RuntimeGlobals;
  return runtime.Deno?.env?.get?.(name) ?? runtime.process?.env?.[name];
}

function configuredEnv(names: readonly string[]) {
  for (const name of names) {
    const value = getEnv(name)?.trim();
    if (value) return value;
  }
  return undefined;
}

function projectUrl() {
  const url = configuredEnv(["SUPABASE_URL", "VITE_SUPABASE_URL"]);
  if (!url) throw new Error("The SpendWise database connection is not configured.");
  return url;
}

function publishableKey() {
  const direct = configuredEnv(["SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY"]);
  if (direct) return direct;
  const keyset = getEnv("SUPABASE_PUBLISHABLE_KEYS");
  if (keyset) {
    try {
      const parsed: unknown = JSON.parse(keyset);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const keys = parsed as Record<string, unknown>;
        const key = [keys.default, ...Object.values(keys)].find(
          (value): value is string =>
            typeof value === "string" && value.trim().startsWith("sb_publishable_"),
        );
        if (key) return key.trim();
      }
    } catch {
      // A legacy key may still be configured below.
    }
  }
  const legacy = configuredEnv(["SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY"]);
  if (legacy) return legacy;
  throw new Error("The SpendWise database connection is not configured.");
}

export function supabaseAnon() {
  const key = publishableKey();
  return createClient<Database>(projectUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) {
          headers.delete("Authorization");
        }
        headers.set("apikey", key);
        return fetch(input, { ...init, headers });
      },
    },
  });
}

export function assertPublicDemoClient(context: ToolContext) {
  if (context.isAuthenticated()) {
    throw new Error("SpendWise's shared sample workspace does not accept private-account data.");
  }
}
