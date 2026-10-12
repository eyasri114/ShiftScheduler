"use client";

import { useEffect, useState, useTransition } from "react";
import { removePushSubscription, savePushSubscription, sendTestPush } from "./actions";

type State = "loading" | "unsupported" | "ios-install" | "no-server" | "denied" | "off" | "on";

function urlBase64ToUint8Array(base64: string) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

const KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

export function PushSetup() {
  const [state, setState] = useState<State>("loading");
  const [msg, setMsg] = useState<{ text: string; bad?: boolean }>();
  const [pending, start] = useTransition();

  useEffect(() => {
    (async () => {
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
      const standalone = window.matchMedia("(display-mode: standalone)").matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true;
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setState(ios && !standalone ? "ios-install" : "unsupported"); return;
      }
      if (!KEY) { setState("no-server"); return; }
      if (Notification.permission === "denied") { setState("denied"); return; }
      const reg = await navigator.serviceWorker.ready;
      setState((await reg.pushManager.getSubscription()) ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, []);

  const enable = () => start(async () => {
    setMsg(undefined);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { setState(perm === "denied" ? "denied" : "off"); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(KEY!) });
      const r = await savePushSubscription(sub.toJSON() as never, navigator.userAgent);
      if (r.error) { setMsg({ text: r.error, bad: true }); await sub.unsubscribe(); return; }
      setState("on");
      setMsg({ text: "ההתראות הופעלו במכשיר הזה." });
    } catch {
      setMsg({ text: "לא הצלחנו להפעיל התראות במכשיר הזה. נסו שוב, או בדפדפן אחר.", bad: true });
    }
  });

  const disable = () => start(async () => {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) { await removePushSubscription(sub.endpoint); await sub.unsubscribe(); }
    setState("off");
    setMsg({ text: "ההתראות כובו במכשיר הזה." });
  });

  const test = () => start(async () => {
    const r = await sendTestPush();
    setMsg(r.error ? { text: r.error, bad: true } : { text: "נשלחה התראת בדיקה. היא אמורה להופיע בעוד כמה שניות." });
  });

  const btn = "rounded-lg px-3.5 py-2 font-semibold disabled:opacity-60";
  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <h2 className="text-lg font-bold">התראות לטלפון</h2>
      <div className="mt-2 text-sm text-muted">
        {state === "loading" && "בודק…"}
        {state === "on" && "ההתראות פעילות במכשיר הזה: תקבלו הודעה כשהסידור מתפרסם או משתנה, וכשבקשה שלכם מאושרת."}
        {state === "off" && "הפעילו כדי לקבל הודעה לטלפון כשהסידור מתפרסם או משתנה, וכשבקשה שלכם מאושרת או נדחית."}
        {state === "denied" && "ההתראות חסומות בדפדפן. כדי לאפשר אותן, פתחו את הגדרות האתר בדפדפן (סמל המנעול ליד הכתובת) ואפשרו התראות."}
        {state === "no-server" && "התראות לטלפון עוד לא הוגדרו בשרת. ההתראות בתוך האפליקציה עובדות כרגיל."}
        {state === "unsupported" && "הדפדפן הזה לא תומך בהתראות. ההתראות בתוך האפליקציה עובדות כרגיל."}
        {state === "ios-install" && (
          <>באייפון, התראות עובדות רק מהאפליקציה המותקנת: לחצו על <strong>שיתוף</strong> ← <strong>הוספה למסך הבית</strong>, פתחו את האפליקציה מהמסך הראשי, וחזרו לכאן.</>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {state === "off" && <button className={`${btn} bg-ink text-surface`} disabled={pending} onClick={enable}>הפעלת התראות</button>}
        {state === "on" && (
          <>
            <button className={`${btn} border border-line-strong`} disabled={pending} onClick={test}>שליחת התראת בדיקה</button>
            <button className={`${btn} text-muted underline underline-offset-4`} disabled={pending} onClick={disable}>כיבוי במכשיר הזה</button>
          </>
        )}
      </div>
      {msg && <p role="status" className={`mt-3 text-sm ${msg.bad ? "text-bad" : "text-ok"}`}>{msg.text}</p>}
    </section>
  );
}
