"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Radar,
  Brain,
  LayoutDashboard,
  Building2,
  FileSearch,
  FileText,
  MonitorPlay,
  FileSignature,
  KanbanSquare,
  Settings,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/research", label: "Investigación de mercado", icon: Radar },
  { href: "/dashboard/prospects", label: "Prospectos", icon: Building2 },
  { href: "/dashboard/audits", label: "Auditorías", icon: FileSearch },
  { href: "/dashboard/reports", label: "Informes", icon: FileText },
  { href: "/dashboard/demos", label: "Demos", icon: MonitorPlay },
  { href: "/dashboard/proposals", label: "Propuestas", icon: FileSignature },
  { href: "/dashboard/pipeline", label: "Pipeline", icon: KanbanSquare },
  { href: "/dashboard/memory", label: "Memoria", icon: Brain },
  { href: "/dashboard/settings", label: "Configuración", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-border-hairline bg-surface-1">
      <div className="flex h-14 items-center gap-2 border-b border-border-hairline px-5">
        <Sparkles className="h-4 w-4 text-accent-450" />
        <span className="text-sm font-semibold tracking-tight">AI Digital Agency OS</span>
      </div>
      <nav className="flex-1 space-y-0.5 p-3">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || (item.href !== "/dashboard" && pathname?.startsWith(item.href));
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-accent-450/10 text-accent-500 dark:text-accent-400"
                  : "text-text-secondary hover:bg-surface-2 hover:text-text-primary"
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
