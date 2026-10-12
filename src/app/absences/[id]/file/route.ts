import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Opens a sick note. The file lives in a private bucket: this asks Supabase
 * for a link valid for 60 seconds. Row-level security on `absences` and the
 * storage rules both check that the viewer is the employee or their manager.
 */
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: a } = await supabase.from("absences").select("attachment_path").eq("id", id).maybeSingle();
  if (!a?.attachment_path) return new NextResponse("לא נמצא קובץ", { status: 404 });

  const { data, error } = await supabase.storage.from("absence-attachments").createSignedUrl(a.attachment_path, 60);
  if (error || !data?.signedUrl) return new NextResponse("אין גישה לקובץ", { status: 403 });
  return NextResponse.redirect(data.signedUrl);
}
