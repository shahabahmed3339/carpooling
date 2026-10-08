import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Commute — Share your commute",
  description: "Find a ride or offer a seat on a dated commute.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-PK">
      <body>{children}</body>
    </html>
  );
}
