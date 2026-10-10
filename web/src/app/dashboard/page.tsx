import OverviewClient from "./overview-client";

/**
 * The overview page.
 *
 * The access check and the shell (sidebar, header, notification bell) are in
 * `layout.tsx`, so they apply to every page under `/dashboard` and cannot be
 * forgotten when a page is added. This component renders only its own content.
 */
export default function DashboardPage() {
  return <OverviewClient />;
}
