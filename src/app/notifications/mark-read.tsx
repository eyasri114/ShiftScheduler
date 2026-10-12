"use client";

import { useEffect } from "react";
import { markAllRead } from "./actions";

/** Opening the notifications page marks them as read (after it has shown which ones were new). */
export function MarkRead() {
  useEffect(() => {
    const t = setTimeout(() => { markAllRead(); }, 1500);
    return () => clearTimeout(t);
  }, []);
  return null;
}
