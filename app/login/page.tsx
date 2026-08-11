"use client";

import { useActionState } from "react";
import Link from "next/link";
import { login } from "./actions";
import { buttonVariants } from "@/components/ui/Button";

export default function LoginPage() {
  const [error, formAction, pending] = useActionState(login, null);

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-0 px-4">
      <div className="w-full max-w-sm space-y-6 rounded-xl border border-border-hairline bg-surface-1 p-6">
        <div>
          <h1 className="text-lg font-semibold">Iniciar sesión</h1>
          <p className="text-sm text-text-secondary">AI Digital Agency OS</p>
        </div>
        <form action={formAction} className="space-y-4">
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
              className="h-10 w-full rounded-lg border border-border-hairline bg-surface-2 px-3 text-sm outline-none focus:border-accent-450"
            />
          </label>
          {error && <p className="text-sm text-status-critical">{error}</p>}
          <button type="submit" disabled={pending} className={buttonVariants({ className: "w-full" })}>
            {pending ? "Entrando..." : "Entrar"}
          </button>
        </form>
        <p className="text-center text-sm text-text-secondary">
          ¿No tienes cuenta?{" "}
          <Link href="/signup" className="text-accent-500 hover:underline">
            Crear cuenta
          </Link>
        </p>
      </div>
    </div>
  );
}
