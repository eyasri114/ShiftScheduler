import Link from "next/link";
import { signOut } from "@/app/auth/actions";
import { ROLE_LABEL, type MyContext } from "@/lib/context";
import { NavLink } from "./nav-link";

export function AppShell({
  context,
  branchName,
  children,
}: {
  context: MyContext;
  branchName?: string;
  children: React.ReactNode;
}) {
  const isManager = context.role !== "employee";
  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 pt-4">
          <Link href="/" className="leading-tight">
            <span className="block text-lg font-bold">{context.org.name}</span>
            <span className="block text-sm text-muted">{branchName ?? context.branches[0]?.name}</span>
          </Link>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-muted sm:inline">
              {context.full_name} · {ROLE_LABEL[context.role]}
            </span>
            <form action={signOut}>
              <button className="rounded-lg border border-line-strong px-3 py-1.5 font-medium hover:border-ink">
                יציאה
              </button>
            </form>
          </div>
        </div>
        <nav className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-3 pt-2" aria-label="ניווט ראשי">
          <NavLink href="/">בית</NavLink>
          <NavLink href="/availability">{isManager ? "אילוצים" : "האילוצים שלי"}</NavLink>
          <NavLink href="/absences">{isManager ? "היעדרויות" : "חופשה ומחלה"}</NavLink>
          {isManager && <NavLink href="/employees">עובדים</NavLink>}
          {isManager && <NavLink href="/settings">הגדרות סניף</NavLink>}
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-5 py-8">{children}</main>
    </div>
  );
}
