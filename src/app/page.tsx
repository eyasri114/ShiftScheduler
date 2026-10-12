import { redirect } from "next/navigation";
import { getMyContext, ROLE_LABEL } from "@/lib/context";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/auth/actions";

export default async function Home() {
  const { user, context } = await getMyContext();
  if (!user) redirect("/login");
  if (!context) redirect("/onboarding");

  const isManager = context.role !== "employee";
  const branch = context.branches[0];

  // Row-level security decides what each person gets back here:
  // managers get the whole branch, employees only their coworkers' names.
  const supabase = await createClient();
  const { data: roster } = branch
    ? await supabase.rpc("branch_roster", { p_branch: branch.id })
    : { data: [] };

  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-5 py-4">
          <div>
            <p className="text-lg font-bold">{context.org.name}</p>
            <p className="text-sm text-muted">{branch ? branch.name : "אין סניף"}</p>
          </div>
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
      </header>

      <main className="mx-auto max-w-4xl px-5 py-8">
        <h1 className="text-2xl font-bold">שלום, {context.full_name.split(" ")[0]}</h1>
        <p className="mt-1 text-muted">
          נכנסת בתור {ROLE_LABEL[context.role]}.{" "}
          {isManager ? "בשלב הבא יופיעו כאן הגדרות הסניף וניהול העובדים." : "בקרוב יופיעו כאן המשמרות שלך."}
        </p>

        <section className="mt-8 rounded-2xl border border-line bg-surface p-5">
          <h2 className="font-bold">צוות הסניף ({roster?.length ?? 0})</h2>
          {roster && roster.length > 0 ? (
            <ul className="mt-3 flex flex-wrap gap-2">
              {roster.map((m: { member_id: string; full_name: string; is_shift_lead: boolean }) => (
                <li key={m.member_id} className="rounded-md border border-line px-2.5 py-1 text-sm">
                  {m.full_name}
                  {m.is_shift_lead && <span className="ms-1.5 text-xs text-muted">אחראי/ת</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted">אין עדיין עובדים בסניף.</p>
          )}
        </section>
      </main>
    </div>
  );
}
