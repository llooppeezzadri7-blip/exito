"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasSupabase } from "@/lib/config/env";

export async function login(_prevState: string | null, formData: FormData): Promise<string | null> {
  if (!hasSupabase) return "Supabase no está configurado en este entorno (ver ENVIRONMENT.md).";

  const supabase = await createClient();
  if (!supabase) return "No se pudo conectar con Supabase.";

  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return error.message;

  redirect("/dashboard");
}
