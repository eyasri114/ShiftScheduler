"use client";

import { useFormStatus } from "react-dom";

export function Field({
  label,
  hint,
  ...input
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <input
        {...input}
        className="rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-base outline-none focus-visible:border-ink focus-visible:ring-2 focus-visible:ring-focus/40"
      />
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function SubmitButton({ children, pending }: { children: React.ReactNode; pending: string }) {
  const { pending: isPending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={isPending}
      className="mt-2 w-full rounded-lg bg-ink px-4 py-2.5 font-semibold text-surface transition hover:opacity-90 disabled:opacity-60"
    >
      {isPending ? pending : children}
    </button>
  );
}

export function Alert({ kind, children }: { kind: "error" | "notice"; children: React.ReactNode }) {
  return (
    <p
      role={kind === "error" ? "alert" : "status"}
      className={
        kind === "error"
          ? "rounded-lg bg-bad-tint px-3 py-2 text-sm text-bad"
          : "rounded-lg bg-ok-tint px-3 py-2 text-sm text-ok"
      }
    >
      {children}
    </p>
  );
}

export function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <p className="mb-6 text-center text-sm font-semibold tracking-wide text-muted">סידור משמרות</p>
        <div className="rounded-2xl border border-line bg-surface p-6 shadow-sm">
          <h1 className="text-2xl font-bold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </main>
  );
}
