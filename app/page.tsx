import { redirect } from "next/navigation";

/**
 * The betting dashboard is the main panel. The marketing-agency product this
 * repo started as still lives at /dashboard.
 */
export default function Home() {
  redirect("/apuestas");
}
