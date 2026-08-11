"use server";

import { createClient } from "@/lib/supabase/server";
import { hasSupabase } from "@/lib/config/env";

export async function signup(_prevState: string | null, formData: FormData): Promise<string | null> {
  if (!hasSupabase) return "Supabase no está configurado en este entorno (ver ENVIRONMENT.md).";

  const supabase = await createClient();
  if (!supabase) return "No se pudo conectar con Supabase.";

  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const agencyName = String(formData.get("agency_name") ?? "");

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: agencyName } },
  });
  if (error) return error.message;

  return "Cuenta creada. Revisa tu email para confirmar el acceso.";
}
