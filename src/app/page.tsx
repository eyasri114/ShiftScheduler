import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getMyContext, ROLE_LABEL } from "@/lib/context";
import { createClient } from "@/lib/supabase/server";

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
    <AppShell context={context}>
      <h1 className="text-2xl font-bold">שלום, {context.full_name.split(" ")[0]}</h1>
      <p className="mt-1 text-muted">
        נכנסת בתור {ROLE_LABEL[context.role]}.{" "}
        {isManager ? "מכאן בונים את הסידור, מאשרים בקשות ומנהלים את הסניף." : "כאן רואים את הסידור, מסמנים אילוצים ומבקשים חופשה."}
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {isManager ? (
          <>
            <QuickLink href="/schedule" title="סידור עבודה" text="שיבוץ אוטומטי לשבוע הבא, תיקונים ופרסום לעובדים." />
            <QuickLink href="/availability" title="אילוצים" text="מי סימן אילוצים לשבוע הבא, ומה כל אחד סימן." />
            <QuickLink href="/absences" title="היעדרויות" text="אישור חופשות ובדיקת אישורי מחלה." />
            <QuickLink href="/employees" title="עובדים" text="הוספה ועריכה של עובדים, היקף משרה, יום מנוחה ואחראי משמרת." />
            <QuickLink href="/settings" title="הגדרות סניף" text="שעות המשמרות, כמה עובדים צריך בכל יום, וכללי המנוחה." />
          </>
        ) : (
          <>
            <QuickLink href="/schedule" title="הסידור" text="המשמרות שלך ושל הצוות, אחרי שהמנהל מפרסם." />
            <QuickLink href="/availability" title="האילוצים שלי" text="סמנו לאילו משמרות אתם יכולים להגיע בשבוע הבא." />
            <QuickLink href="/absences" title="חופשה ומחלה" text="בקשת חופשה, דיווח מחלה וצירוף אישור מחלה." />
          </>
        )}
      </div>

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
    </AppShell>
  );
}

function QuickLink({ href, title, text }: { href: string; title: string; text: string }) {
  return (
    <Link href={href} className="rounded-2xl border border-line bg-surface p-5 transition hover:border-ink">
      <span className="text-lg font-bold">{title} ←</span>
      <span className="mt-1 block text-sm text-muted">{text}</span>
    </Link>
  );
}
