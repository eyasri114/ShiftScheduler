import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type Role = "owner" | "manager" | "employee";

export type MyContext = {
  member_id: string;
  full_name: string;
  role: Role;
  org: { id: string; name: string };
  branches: { id: string; name: string }[];
};

export const ROLE_LABEL: Record<Role, string> = {
  owner: "בעלים",
  manager: "מנהל/ת סניף",
  employee: "עובד/ת",
};

/**
 * Who is signed in and which business they belong to. Links an invited
 * employee to their record on first sign-in. Cached per request.
 */
export const getMyContext = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { user: null, context: null };

  let { data } = await supabase.rpc("my_context");
  if (!data) {
    const { data: linked } = await supabase.rpc("claim_membership");
    if (linked) ({ data } = await supabase.rpc("my_context"));
  }
  return { user, context: (data as MyContext | null) ?? null };
});
