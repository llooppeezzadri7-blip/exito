"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signup } from "./actions";
import { buttonVariants } from "@/components/ui/Button";

export default function SignupPage() {
  const [message, formAction, pending] = useActionState(signup, null);

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-0 px-4">
      <div className="w-full max-w-sm space-y-6 rounded-xl border border-border-hairline bg-surface-1 p-6">
        <div>
          <h1 className="text-lg font-semibold">Crear cuenta</h1>
          <p className="text-sm text-text-secondary">AI Digital Agency OS</p>
        </div>
        <form action={formAction} className="space-y-4">
          <label className="block text-sm">
            <span className="mb-1 block text-text-secondary">Nombre de la agencia</span>
            <input
              name="agency_name"
              required
              className="h-10 w-full rounded-lg border border-border-hairline bg-surface-2 px-3 text-sm outline-none focus:border-accent-450"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-text-secondary">Email</span>
            <input
              type="email"
              name="email"
              required
              className="h-10 w-full rounded-lg border border-border-hairline bg-surface-2 px-3 text-sm outline-none focus:border-accent-450"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-text-secondary">Contraseña</span>
            <input
              type="password"
              name="password"
              required
              minLength={6}
              className="h-10 w-full rounded-lg border border-border-hairline bg-surface-2 px-3 text-sm outline-none focus:border-accent-450"
            />
          </label>
          {message && <p className="text-sm text-text-secondary">{message}</p>}
          <button type="submit" disabled={pending} className={buttonVariants({ className: "w-full" })}>
            {pending ? "Creando..." : "Crear cuenta"}
          </button>
        </form>
        <p className="text-center text-sm text-text-secondary">
          ¿Ya tienes cuenta?{" "}
          <Link href="/login" className="text-accent-500 hover:underline">
            Iniciar sesión
          </Link>
        </p>
      </div>
    </div>
  );
}
