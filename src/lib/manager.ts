import { redirect } from "next/navigation";
import { getMyContext } from "@/lib/context";

/**
 * For manager-only pages: returns the signed-in manager's context and the
 * branch they are working on. Employees are sent to the home page.
 * (The database enforces the same rule; this only keeps the UI tidy.)
 */
export async function requireManager(branchId?: string) {
  const { user, context } = await getMyContext();
  if (!user) redirect("/login");
  if (!context) redirect("/onboarding");
  if (context.role === "employee") redirect("/");

  const branch = context.branches.find((b) => b.id === branchId) ?? context.branches[0];
  if (!branch) redirect("/");
  return { user, context, branch };
}
