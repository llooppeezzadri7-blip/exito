import Link from "next/link";
import { cn } from "@/lib/utils/cn";

const LINKS = [
  { href: "/apuestas", label: "Dashboard" },
  { href: "/apuestas/historial", label: "Historial" },
  { href: "/apuestas/calculadora", label: "Calculadora" },
];

export function Nav({ active }: { active: string }) {
  return (
    <nav className="flex flex-wrap gap-1 rounded-lg border border-border-hairline bg-surface-1 p-1">
      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            active === link.href
              ? "bg-accent-450 text-white"
              : "text-text-secondary hover:bg-surface-2 hover:text-text-primary"
          )}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
