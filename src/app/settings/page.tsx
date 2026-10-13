import { AppShell } from "@/components/app-shell";
import { requireManager } from "@/lib/manager";
import { createClient } from "@/lib/supabase/server";
import { SettingsForm, type BranchSettings, type Slot } from "./settings-form";

export default async function SettingsPage() {
  const { context, branch } = await requireManager();
  const supabase = await createClient();

  const [{ data: b }, { data: slots }] = await Promise.all([
    supabase
      .from("branches")
      .select("name, shift_model, min_rest_hours, weekly_rest_hours, require_shift_lead, closed_weekdays, swap_approval")
      .eq("id", branch.id)
      .single(),
    supabase.from("template_slots").select("weekday, kind, start_time, end_time, required").eq("branch_id", branch.id),
  ]);

  return (
    <AppShell context={context} branchName={branch.name}>
      <h1 className="text-2xl font-bold">הגדרות סניף</h1>
      <p className="mt-1 text-muted">שעות המשמרות, כמה עובדים צריך בכל משמרת, וכללי המנוחה.</p>
      <div className="mt-6">
        {b ? (
          <SettingsForm branch={b as BranchSettings} slots={(slots ?? []) as Slot[]} />
        ) : (
          <p className="text-bad">לא הצלחנו לטעון את הגדרות הסניף.</p>
        )}
      </div>
    </AppShell>
  );
}
