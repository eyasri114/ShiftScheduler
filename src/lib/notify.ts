import "server-only";
import webpush from "web-push";
import { createClient } from "@/lib/supabase/server";

type Target = { member_id?: string; endpoint: string; p256dh: string; auth: string };
export type Message = { kind: string; title: string; body?: string; url?: string };
/** A push alert the database prepared, with its own text (used by shift swaps). */
export type PushRow = { endpoint: string; p256dh: string; auth: string; title: string; body?: string | null; url?: string | null };

const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const privateKey = process.env.VAPID_PRIVATE_KEY;
const subject = process.env.VAPID_SUBJECT || "mailto:admin@example.com";
const pushReady = Boolean(publicKey && privateKey);
if (pushReady) webpush.setVapidDetails(subject, publicKey!, privateKey!);

/**
 * Sends phone alerts. Without VAPID keys configured, only the in-app
 * notifications (already stored by the database) exist.
 */
async function send(items: { target: Target; payload: string }[]) {
  if (!pushReady || !items.length) return;
  const dead: string[] = [];
  await Promise.all(items.map(async ({ target: t, payload }) => {
    try {
      await webpush.sendNotification({ endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } },
        payload, { TTL: 60 * 60 * 24, urgency: "normal" });
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) dead.push(t.endpoint); // phone unsubscribed or app reinstalled
      else console.error("push failed", code ?? err);
    }
  }));
  if (dead.length) {
    const supabase = await createClient();
    await supabase.rpc("remove_dead_subscriptions", { p_endpoints: dead });
  }
}

const payloadOf = (title: string, body?: string | null, url?: string | null) =>
  JSON.stringify({ title, body: body ?? "", url: url ?? "/" });

async function push(targets: Target[], msg: Message) {
  const payload = payloadOf(msg.title, msg.body, msg.url);
  await send(targets.map((target) => ({ target, payload })));
}

/** Sends alerts that the database already composed per person. */
export async function pushRows(rows: PushRow[]) {
  await send(rows.map((r) => ({ target: r, payload: payloadOf(r.title, r.body, r.url) })));
}

/** A manager notifies people they manage. The database ignores anyone else. */
export async function notifyMembers(memberIds: string[], msg: Message) {
  if (!memberIds.length) return;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("notify_members", {
    p_members: memberIds, p_kind: msg.kind, p_title: msg.title, p_body: msg.body ?? null, p_url: msg.url ?? null,
  });
  if (error) { console.error("notify_members", error.message); return; }
  await push((data ?? []) as Target[], msg);
}

/** Anyone notifies the managers of their own branch (e.g. a new vacation request). */
export async function notifyManagers(msg: Message) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("notify_branch_managers", {
    p_kind: msg.kind, p_title: msg.title, p_body: msg.body ?? null, p_url: msg.url ?? null,
  });
  if (error) { console.error("notify_branch_managers", error.message); return; }
  await push((data ?? []) as Target[], msg);
}

export const pushConfigured = () => pushReady;
