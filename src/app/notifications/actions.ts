"use server";

import { revalidatePath } from "next/cache";
import webpush from "web-push";
import { createClient } from "@/lib/supabase/server";
import { getMyContext } from "@/lib/context";

export async function markAllRead() {
  const supabase = await createClient();
  await supabase.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
  revalidatePath("/", "layout");
}

type Sub = { endpoint: string; keys: { p256dh: string; auth: string } };

export async function savePushSubscription(sub: Sub, userAgent: string): Promise<{ error?: string }> {
  const { context } = await getMyContext();
  if (!context) return { error: "צריך להתחבר מחדש." };
  if (!sub?.endpoint?.startsWith("https://") || !sub.keys?.p256dh || !sub.keys?.auth) return { error: "המכשיר החזיר נתונים לא תקינים." };

  const supabase = await createClient();
  // The same phone may have been registered by another account before.
  await supabase.rpc("remove_dead_subscriptions", { p_endpoints: [sub.endpoint] });
  const { error } = await supabase.from("push_subscriptions").insert({
    member_id: context.member_id, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth,
    user_agent: userAgent.slice(0, 300),
  });
  if (error) return { error: "שמירת המכשיר נכשלה. נסו שוב." };
  return {};
}

export async function removePushSubscription(endpoint: string) {
  const supabase = await createClient();
  await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
}

/** Sends a test alert to the caller's own devices. */
export async function sendTestPush(): Promise<{ error?: string; sent?: number }> {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return { error: "התראות לטלפון עוד לא הוגדרו בשרת." };
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@example.com", pub, priv);

  const supabase = await createClient();
  const { data: subs } = await supabase.from("push_subscriptions").select("endpoint, p256dh, auth");
  let sent = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ title: "בדיקת התראות", body: "ההתראות עובדות במכשיר הזה.", url: "/notifications" }));
      sent++;
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await supabase.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
    }
  }
  return sent ? { sent } : { error: "לא נמצא מכשיר פעיל. הפעילו התראות מחדש." };
}
