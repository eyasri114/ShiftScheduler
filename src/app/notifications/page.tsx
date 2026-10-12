import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getMyContext } from "@/lib/context";
import { createClient } from "@/lib/supabase/server";
import { MarkRead } from "./mark-read";
import { PushSetup } from "./push-setup";

const fmt = new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });

export default async function NotificationsPage() {
  const { user, context } = await getMyContext();
  if (!user) redirect("/login");
  if (!context) redirect("/onboarding");

  const supabase = await createClient();
  const { data } = await supabase.from("notifications").select("id, title, body, url, created_at, read_at")
    .order("created_at", { ascending: false }).limit(50);
  const items = data ?? [];
  const unread = items.some((n) => !n.read_at);

  return (
    <AppShell context={context}>
      <h1 className="text-2xl font-bold">התראות</h1>
      <div className="mt-6"><PushSetup /></div>
      <section className="mt-6 rounded-2xl border border-line bg-surface p-5">
        <h2 className="text-lg font-bold">אחרונות</h2>
        {items.length ? (
          <ul className="mt-2 divide-y divide-line">
            {items.map((n) => {
              const inner = (
                <>
                  <span className="flex items-center gap-2">
                    {!n.read_at && <span className="size-2 flex-none rounded-full bg-bad" aria-label="חדש" />}
                    <strong className={n.read_at ? "font-semibold" : ""}>{n.title}</strong>
                  </span>
                  {n.body && <span className="mt-0.5 block text-sm text-muted">{n.body}</span>}
                  <span className="mt-0.5 block text-xs text-muted">{fmt.format(new Date(n.created_at))}</span>
                </>
              );
              return (
                <li key={n.id} className="py-3">
                  {n.url ? <Link href={n.url} className="block hover:opacity-80">{inner}</Link> : inner}
                </li>
              );
            })}
          </ul>
        ) : <p className="mt-2 text-sm text-muted">אין התראות עדיין.</p>}
      </section>
      {unread && <MarkRead />}
    </AppShell>
  );
}
