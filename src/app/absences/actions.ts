"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getMyContext } from "@/lib/context";
import { dateRange, isIsoDate } from "@/lib/week";
import { notifyManagers, notifyMembers } from "@/lib/notify";

export type AbsenceFormState = { error?: string; saved?: string } | undefined;

const BUCKET = "absence-attachments";
const MAX_BYTES = 10 * 1024 * 1024;
const TYPES: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "application/pdf": "pdf",
};

function checkFile(file: FormDataEntryValue | null): File | null | string {
  if (!(file instanceof File) || file.size === 0) return null;
  if (!TYPES[file.type]) return "אפשר לצרף רק תמונה (JPG, PNG, WEBP, HEIC) או PDF.";
  if (file.size > MAX_BYTES) return "הקובץ גדול מ-10MB. אפשר לצלם את האישור שוב או לשלוח PDF קטן יותר.";
  return file;
}

/** Uploads into <member>/<absence>/… — the storage rules check the first folder. */
async function upload(memberId: string, absenceId: string, file: File) {
  const supabase = await createClient();
  const path = `${memberId}/${absenceId}/certificate-${Date.now()}.${TYPES[file.type]}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type });
  if (error) return { error };
  const { error: e2 } = await supabase.from("absences").update({ attachment_path: path }).eq("id", absenceId);
  return { error: e2 };
}

export async function requestAbsence(_: AbsenceFormState, form: FormData): Promise<AbsenceFormState> {
  const { context } = await getMyContext();
  if (!context) return { error: "צריך להתחבר מחדש." };
  const isManager = context.role !== "employee";

  const memberId = isManager && form.get("member_id") ? String(form.get("member_id")) : context.member_id;
  const type = form.get("type") === "sick" ? "sick" : "vacation";
  const start_date = String(form.get("start_date") ?? "");
  const end_date = String(form.get("end_date") ?? "") || start_date;
  const note = String(form.get("note") ?? "").trim() || null;
  if (!isIsoDate(start_date) || !isIsoDate(end_date)) return { error: "בחרו תאריך התחלה ותאריך סיום." };
  if (end_date < start_date) return { error: "תאריך הסיום לפני תאריך ההתחלה." };
  const file = checkFile(form.get("file"));
  if (typeof file === "string") return { error: file };

  const supabase = await createClient();
  const { data, error } = await supabase.from("absences")
    .insert({ member_id: memberId, type, start_date, end_date, note })
    .select("id").single();
  if (error || !data) return { error: "השמירה נכשלה. נסו שוב." };

  let fileNote = "";
  if (file) {
    const r = await upload(memberId, data.id, file);
    if (r.error) fileNote = " הקובץ לא הועלה; אפשר לצרף אותו שוב מהרשימה.";
  }

  revalidatePath("/absences");
  revalidatePath("/availability");
  const self = memberId === context.member_id;
  if (self && context.role !== "owner") {  // tell the branch managers; an owner filing for themselves has no one to tell
    const range = dateRange(start_date, end_date);
    await notifyManagers(type === "sick"
      ? { kind: "sick_reported", title: `${context.full_name} דיווח/ה על מחלה`, body: range + (file ? " · צורף אישור" : ""), url: "/absences" }
      : { kind: "vacation_requested", title: `${context.full_name} ביקש/ה חופשה`, body: range + (note ? ` · ${note}` : ""), url: "/absences" });
  }
  if (type === "sick") {
    return { saved: (self ? "המחלה דווחה למנהל." : "המחלה נרשמה.") +
      " משמרות שכבר שובצו בימים האלה הוסרו מהסידור." + (file ? fileNote : self ? " אפשר לצרף את אישור המחלה גם מאוחר יותר." : "") };
  }
  return { saved: (isManager && !self ? "בקשת החופשה נשמרה וממתינה לאישור." : "הבקשה נשלחה למנהל לאישור.") + fileNote };
}

export async function attachCertificate(absenceId: string, _: AbsenceFormState, form: FormData): Promise<AbsenceFormState> {
  const file = checkFile(form.get("file"));
  if (!file) return { error: "בחרו קובץ." };
  if (typeof file === "string") return { error: file };

  const supabase = await createClient();
  const { data: a } = await supabase.from("absences").select("member_id").eq("id", absenceId).maybeSingle();
  if (!a) return { error: "הבקשה לא נמצאה." };
  const r = await upload(a.member_id, absenceId, file);
  if (r.error) return { error: "ההעלאה נכשלה. נסו שוב." };
  revalidatePath("/absences");
  const { context } = await getMyContext();
  if (context && a.member_id === context.member_id) {
    await notifyManagers({ kind: "certificate_added", title: `${context.full_name} צירף/ה אישור מחלה`, url: "/absences" });
  }
  return { saved: "האישור צורף וממתין לבדיקת המנהל." };
}

export async function decideVacation(absenceId: string, approve: boolean) {
  const { context } = await getMyContext();
  if (!context) return;
  const supabase = await createClient();
  const { data: a } = await supabase.from("absences").update({
    status: approve ? "approved" : "rejected",
    reviewed_by: context.member_id,
    reviewed_at: new Date().toISOString(),
  }).eq("id", absenceId).select("member_id, start_date, end_date").maybeSingle();
  if (a) {
    await notifyMembers([a.member_id], {
      kind: approve ? "vacation_approved" : "vacation_rejected",
      title: approve ? "בקשת החופשה שלך אושרה" : "בקשת החופשה שלך נדחתה",
      body: dateRange(a.start_date, a.end_date), url: "/absences",
    });
  }
  revalidatePath("/absences");
  revalidatePath("/availability");
}

export async function reviewCertificate(absenceId: string, valid: boolean) {
  const supabase = await createClient();
  const { data: a } = await supabase.from("absences").update({ attachment_review: valid ? "valid" : "invalid" })
    .eq("id", absenceId).select("member_id, start_date, end_date").maybeSingle();
  if (a && !valid) {
    await notifyMembers([a.member_id], { kind: "certificate_invalid", title: "אישור המחלה שצירפת סומן כלא תקין",
      body: `${dateRange(a.start_date, a.end_date)} · אפשר לצרף אישור חדש`, url: "/absences" });
  }
  revalidatePath("/absences");
}

export async function deleteAbsence(absenceId: string) {
  const supabase = await createClient();
  const { data: a } = await supabase.from("absences").select("attachment_path").eq("id", absenceId).maybeSingle();
  const { data: deleted } = await supabase.from("absences").delete().eq("id", absenceId).select("id");
  if (deleted?.length && a?.attachment_path) {
    await supabase.storage.from(BUCKET).remove([a.attachment_path]);
  }
  revalidatePath("/absences");
  revalidatePath("/availability");
}
