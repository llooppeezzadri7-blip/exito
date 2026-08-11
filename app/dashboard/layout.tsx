import { Sidebar } from "@/components/dashboard/Sidebar";
import { DemoModeBanner } from "@/components/dashboard/DemoModeBanner";
import { dataProvider } from "@/lib/config/env";

export default function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        {dataProvider === "mock" && <DemoModeBanner />}
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl px-6 py-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
