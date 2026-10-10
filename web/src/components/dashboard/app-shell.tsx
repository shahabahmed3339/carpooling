"use client";

/**
 * The dashboard chrome: a sidebar for navigation and a header holding the mode
 * switch, the notification bell and the account menu.
 *
 * Previously every section lived on one long page, so nothing was addressable and
 * the notification inbox competed with the work. Splitting navigation into a
 * sidebar and the inbox into a bell is the change that makes each page a page.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import SignOutButton from "@/app/auth/complete/sign-out";
import { useDashboard } from "./dashboard-context";
import styles from "./shell.module.css";

type NavItem = { href: string; label: string; roles?: Array<"RIDER" | "DRIVER">; hint?: string };

/**
 * Navigation is role-aware rather than showing every link in both modes. A rider
 * has no commute to publish and a driver has nothing to search for, so offering
 * those links produces pages that can only say "switch mode first".
 */
const NAV: NavItem[] = [
  { href: "/dashboard", label: "Overview", hint: "Your account at a glance" },
  { href: "/dashboard/trips", label: "My commute & trips", roles: ["DRIVER"], hint: "Publish and manage dates you are driving" },
  { href: "/dashboard/search", label: "Find a ride", roles: ["RIDER"], hint: "Search published trips" },
  { href: "/dashboard/requests", label: "Requests", hint: "Seat requests you are part of" },
  { href: "/dashboard/activity", label: "Activity", hint: "Everything, from both modes" },
  { href: "/dashboard/ratings", label: "Ratings", hint: "What other participants said" },
  { href: "/dashboard/safety", label: "Safety", hint: "Reports, blocked users, support" },
  { href: "/dashboard/settings", label: "Settings", hint: "Profile and account" },
];

function NotificationBell() {
  const {
    notifications,
    notificationsLoaded,
    unreadCount,
    notificationHasMore,
    loadingOlderNotifications,
    markNotificationRead,
    loadOlderNotifications,
  } = useDashboard();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on an outside click or Escape. A popover that only closes by clicking the
  // bell again traps the user when it covers what they were reading.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className={styles.bellWrap} ref={containerRef}>
      <button
        type="button"
        className={styles.bell}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        onClick={() => setOpen((current) => !current)}
      >
        <span aria-hidden="true">🔔</span>
        {unreadCount > 0 && <span className={styles.badge}>{unreadCount > 99 ? "99+" : unreadCount}</span>}
      </button>

      {open && (
        <div className={styles.popover} role="dialog" aria-label="Notifications">
          <div className={styles.popoverHead}>
            <strong>Notifications</strong>
            {unreadCount > 0 && (
              <button type="button" className={styles.linkButton} onClick={() => void markNotificationRead()}>
                Mark all read
              </button>
            )}
          </div>
          <div className={styles.popoverBody}>
            {notifications.length === 0 ? (
              <p className={styles.popoverEmpty}>{notificationsLoaded ? "No notifications yet." : "Loading…"}</p>
            ) : (
              notifications.map((notification) => (
                <div key={notification.id} className={styles.notification}>
                  <div>
                    <strong>
                      {notification.title}
                      {notification.readAt ? "" : " · New"}
                    </strong>
                    <p>{notification.body}</p>
                    <p className={styles.notificationTime}>{new Date(notification.createdAt).toLocaleString()}</p>
                  </div>
                  <div className={styles.notificationActions}>
                    {notification.kind === "SAFETY_REPORT_RECEIVED" || notification.kind === "TRIP_DISPUTE_REVIEW_REQUESTED" ? (
                      <Link href="/moderation/reports" onClick={() => setOpen(false)}>Open queue</Link>
                    ) : notification.kind === "SAFETY_REPORT_STATUS_UPDATED" ? (
                      <Link href="/dashboard/safety" onClick={() => setOpen(false)}>View my reports</Link>
                    ) : (
                      <Link href="/dashboard/requests" onClick={() => setOpen(false)}>View</Link>
                    )}
                    {!notification.readAt && (
                      <button type="button" className={styles.linkButton} onClick={() => void markNotificationRead(notification.id)}>
                        Mark read
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
            {notificationHasMore && (
              <button
                type="button"
                className={styles.moreButton}
                disabled={loadingOlderNotifications}
                onClick={() => void loadOlderNotifications()}
              >
                {loadingOlderNotifications ? "Loading…" : "Load older notifications"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { role, switchMode, busy, accountEmail, notice, error, clearMessages } = useDashboard();
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);

  const items = NAV.filter((item) => !item.roles || item.roles.includes(role));

  return (
    <div className={styles.shell} data-nav-open={navOpen}>
      <aside className={styles.sidebar} aria-label="Dashboard navigation">
        <div className={styles.brand}>
          <span className={styles.brandMark}>CP</span>
          <span className={styles.brandText}>Carpool Pakistan</span>
        </div>
        <nav className={styles.nav}>
          {items.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={active ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink}
                aria-current={active ? "page" : undefined}
                onClick={() => setNavOpen(false)}
              >
                <span className={styles.navLabel}>{item.label}</span>
                {item.hint && <span className={styles.navHint}>{item.hint}</span>}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className={styles.main}>
        <header className={styles.header}>
          <button
            type="button"
            className={styles.navToggle}
            aria-expanded={navOpen}
            aria-label="Toggle navigation"
            onClick={() => setNavOpen((current) => !current)}
          >
            <span aria-hidden="true">☰</span>
          </button>

          <div className={styles.modeSwitch} role="group" aria-label="Dashboard mode">
            <button type="button" aria-pressed={role === "RIDER"} disabled={busy} onClick={() => void switchMode("RIDER")}>
              Rider
            </button>
            <button type="button" aria-pressed={role === "DRIVER"} disabled={busy} onClick={() => void switchMode("DRIVER")}>
              Driver
            </button>
          </div>

          <div className={styles.headerRight}>
            <NotificationBell />
            <details className={styles.accountMenu}>
              <summary aria-label="Account menu">{accountEmail}</summary>
              <div className={styles.accountBody}>
                <p className={styles.accountEmail}>{accountEmail}</p>
                <Link href="/dashboard/settings" className={styles.accountLink}>Profile &amp; settings</Link>
                <SignOutButton />
              </div>
            </details>
          </div>
        </header>

        {(notice || error) && (
          <div className={error ? `${styles.banner} ${styles.bannerError}` : `${styles.banner} ${styles.bannerNotice}`} role={error ? "alert" : "status"}>
            <span>{error || notice}</span>
            <button type="button" className={styles.linkButton} onClick={clearMessages} aria-label="Dismiss message">✕</button>
          </div>
        )}

        <main className={styles.content}>{children}</main>
      </div>
    </div>
  );
}
