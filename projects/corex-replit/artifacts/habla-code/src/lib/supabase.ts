import { createClient } from "@supabase/supabase-js";

const environment = import.meta.env ?? {};
const supabaseUrl = environment.VITE_SUPABASE_URL?.trim();
const supabasePublicKey = environment.VITE_SUPABASE_PUBLIC_KEY?.trim();

function isValidHttpUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export const supabaseConfigReady = Boolean(
  isValidHttpUrl(supabaseUrl) && supabasePublicKey,
);

export const supabase = (() => {
  if (!supabaseConfigReady || !supabaseUrl || !supabasePublicKey) return null;

  try {
    return createClient(supabaseUrl, supabasePublicKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: false,
        persistSession: true,
      },
    });
  } catch (error) {
    console.error("CoreX: no se pudo inicializar Supabase.", error);
    return null;
  }
})();