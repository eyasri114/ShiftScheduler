import Link from "next/link";
import { signOut } from "@/app/auth/actions";
import { ROLE_LABEL, type MyContext } from "@/lib/context";
import { createClient } from "@/lib/supabase/server";
import { NavLink } from "./nav-link";

export async function AppShell({
  context,
  branchName,
  children,
}: {
  context: MyContext;
  branchName?: string;
  children: React.ReactNode;
}) {
  const isManager = context.role !== "employee";
  const supabase = await createClient();
  const { count } = await supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null);
  const unread = count ?? 0;

  return (
    <div className="min-h-dvh pb-[env(safe-area-inset-bottom)]">
      <header className="border-b border-line bg-surface pt-[env(safe-area-inset-top)] print:hidden">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-x-4 px-4 pt-3 sm:px-5 sm:pt-4">
          <Link href="/" className="min-w-0 leading-tight">
            <span className="block truncate text-lg font-bold">{context.org.name}</span>
            <span className="block truncate text-sm text-muted">{branchName ?? context.branches[0]?.name}</span>
          </Link>
          <div className="flex flex-none items-center gap-2 text-sm sm:gap-3">
            <span className="hidden text-muted md:inline">
              {context.full_name} · {ROLE_LABEL[context.role]}
            </span>
            <Link href="/notifications" aria-label={unread ? `התראות, ${unread} חדשות` : "התראות"}
              className="relative rounded-lg border border-line-strong p-1.5 hover:border-ink">
              <svg viewBox="0 0 24 24" aria-hidden className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
              </svg>
              {unread > 0 && (
                <span className="absolute -end-1.5 -top-1.5 min-w-5 rounded-full bg-bad px-1 text-center text-[11px] font-bold leading-5 text-surface">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </Link>
            <form action={signOut}>
              <button className="rounded-lg border border-line-strong px-3 py-1.5 font-medium hover:border-ink">יציאה</button>
            </form>
          </div>
        </div>
        <nav className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-2 pt-2 sm:px-3" aria-label="ניווט ראשי">
          <NavLink href="/">בית</NavLink>
          <NavLink href="/schedule">{isManager ? "סידור עבודה" : "סידור"}</NavLink>
          <NavLink href="/availability">{isManager ? "אילוצים" : "האילוצים שלי"}</NavLink>
          <NavLink href="/absences">{isManager ? "היעדרויות" : "חופשה ומחלה"}</NavLink>
          {isManager && <NavLink href="/employees">עובדים</NavLink>}
          {isManager && <NavLink href="/settings">הגדרות סניף</NavLink>}
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-5 sm:py-8">{children}</main>
    </div>
  );
}
