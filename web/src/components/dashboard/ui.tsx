"use client";

/**
 * Small presentational primitives shared by the dashboard pages.
 *
 * Each page previously re-wrote the same panel/empty/loading markup inline, which
 * is how the loading and empty states drifted apart between sections. One
 * implementation means the "Loading…" versus "none yet" distinction — the fix made
 * earlier when a slow load was shown as "No requests yet." — cannot be lost on a
 * page that forgets it.
 */

import type { FormEvent, ReactNode } from "react";
import styles from "./ui.module.css";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className={styles.pageHeader}>
      <div>
        <h1 className={styles.title}>{title}</h1>
        {description && <p className={styles.description}>{description}</p>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </header>
  );
}

export function Panel({
  title,
  description,
  children,
  id,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section className={styles.panel} id={id}>
      {title && <h2 className={styles.panelTitle}>{title}</h2>}
      {description && <p className={styles.muted}>{description}</p>}
      {children}
    </section>
  );
}

/**
 * An empty state that distinguishes "nothing here" from "not loaded yet".
 *
 * `loaded` is required rather than optional: a caller must decide whether it knows
 * the list is empty, and cannot accidentally claim emptiness while still loading.
 */
export function EmptyState({ loaded, message }: { loaded: boolean; message: string }) {
  return <p className={styles.muted}>{loaded ? message : "Loading…"}</p>;
}

export function Item({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className={styles.item}>
      <div className={styles.itemBody}>{children}</div>
      {actions && <div className={styles.itemActions}>{actions}</div>}
    </div>
  );
}

export function Button({
  children,
  variant = "primary",
  ...rest
}: { children: ReactNode; variant?: "primary" | "secondary" | "danger" } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const className = variant === "danger" ? styles.danger : variant === "secondary" ? styles.secondary : styles.primary;
  return <button {...rest} className={className}>{children}</button>;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      {children}
      {hint && <span className={styles.fieldHint}>{hint}</span>}
    </label>
  );
}

export function Form({ children, onSubmit }: { children: ReactNode; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <form className={styles.form} onSubmit={onSubmit}>{children}</form>;
}

export function InlineMessage({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" }) {
  return <p className={tone === "warn" ? styles.warn : styles.info}>{children}</p>;
}

/** A labelled number for the overview cards. */
export function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statValue}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
      {hint && <span className={styles.statHint}>{hint}</span>}
    </div>
  );
}
