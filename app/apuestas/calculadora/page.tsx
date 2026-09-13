import type { Metadata } from "next";
import { Calculadora } from "./Calculadora";
import { SYSTEM_BAND } from "@/lib/betting/sportium";

export const metadata: Metadata = {
  title: "Sistema de apuestas · LaLiga y Premier",
  description:
    "Calculadora de valor, supercuotas, combinadas y backtest para apostar con criterio en Sportium.",
};

export default function ApuestasPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold text-text-primary">Sistema de apuestas</h1>
        <p className="max-w-3xl text-sm leading-relaxed text-text-secondary">
          LaLiga y Premier, orientado a Sportium. La regla que gobierna todo lo demás: con un 80% de acierto la
          cuota de equilibrio es exactamente <strong className="text-text-primary">1,25</strong>. Por debajo de{" "}
          <strong className="text-text-primary">{SYSTEM_BAND.min.toFixed(2)}</strong> un sistema de acierto alto
          pierde dinero aunque acierte 8 de cada 10. Todo lo que hay aquí sirve para no salirse de la banda{" "}
          {SYSTEM_BAND.min.toFixed(2)} – {SYSTEM_BAND.max.toFixed(2)}.
        </p>
      </header>

      <Calculadora />

      <footer className="mt-2 rounded-lg border border-border-hairline bg-surface-0 p-4 text-xs leading-relaxed text-text-secondary">
        <p>
          <strong className="text-text-primary">Antes de apostar un euro.</strong> Ninguna estrategia de esta página
          es una recomendación: son hipótesis que hay que medir con datos propios. Aunque el sistema salga positivo,
          el margen es fino y dos cosas lo atacan de frente: Sportium limita las cuentas ganadoras, y las ganancias
          de juego tributan en el IRPF (consúltalo con un gestor antes de escalar volumen).
        </p>
        <p className="mt-2">
          El resultado más probable para un apostante particular es perder dinero. Apuesta solo lo que puedas
          permitirte perder. Juego responsable:{" "}
          <a
            href="https://www.ordenacionjuego.es/es/jugar-bien"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-500 underline"
          >
            ordenacionjuego.es
          </a>
          .
        </p>
      </footer>
    </main>
  );
}
