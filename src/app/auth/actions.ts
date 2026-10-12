"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { authErrorMessage } from "@/lib/auth-errors";

export type FormState = { error?: string; notice?: string; email?: string } | undefined;

const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

export async function signIn(_: FormState, form: FormData): Promise<FormState> {
  const email = str(form, "email");
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "מלאו אימייל וסיסמה.", email };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: authErrorMessage(error.message), email };

  revalidatePath("/", "layout");
  redirect("/");
}

export async function signUp(_: FormState, form: FormData): Promise<FormState> {
  const fullName = str(form, "full_name");
  const email = str(form, "email");
  const password = String(form.get("password") ?? "");
  if (!fullName || !email || !password) return { error: "מלאו את כל השדות.", email };
  if (password.length < 8) return { error: "הסיסמה צריכה להיות לפחות 8 תווים.", email };

  const origin = (await headers()).get("origin") ?? "http://localhost:3000";
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${origin}/auth/callback`,
      data: { full_name: fullName },
    },
  });
  if (error) return { error: authErrorMessage(error.message), email };

  // Email confirmation turned off in Supabase → already signed in.
  if (data.session) {
    revalidatePath("/", "layout");
    redirect("/");
  }
  // Supabase hides whether the address is already registered; an existing
  // address comes back with no identities.
  if (data.user && data.user.identities?.length === 0) {
    return { error: authErrorMessage("already registered"), email };
  }
  return {
    notice: `שלחנו קישור אישור ל-${email}. לחצו עליו כדי להשלים את ההרשמה.`,
    email,
  };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}

export async function createBusiness(_: FormState, form: FormData): Promise<FormState> {
  const orgName = str(form, "org_name");
  const branchName = str(form, "branch_name");
  const fullName = str(form, "full_name");
  if (!orgName || !branchName || !fullName) return { error: "מלאו את כל השדות." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_organization", {
    p_org_name: orgName,
    p_branch_name: branchName,
    p_full_name: fullName,
  });
  if (error) {
    if (error.code === "23505") redirect("/");
    return { error: "לא הצלחנו ליצור את העסק. נסו שוב." };
  }
  revalidatePath("/", "layout");
  redirect("/");
}
