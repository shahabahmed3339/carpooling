import Link from "next/link";
import LoginForm from "./login-form";
import styles from "./login.module.css";

export default function LoginPage() {
  const enabled = process.env.AUTH_ENABLED === "true";
  const authHost = process.env.BETTER_AUTH_URL ? new URL(process.env.BETTER_AUTH_URL).hostname.replace(/^\[|\]$/g, "") : "";
  const localDevelopment = process.env.NODE_ENV === "development" && ["localhost", "127.0.0.1", "::1"].includes(authHost);

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <Link className={styles.brand} href="/" aria-label="Carpool Pakistan home">
          <span className={styles.brandMark}>c</span>
          <span>commute<span className={styles.brandDot}>.</span></span>
        </Link>
        <p className={styles.kicker}>CARPOOL PAKISTAN</p>
        <h1>Create an account or sign in</h1>
        <p className={styles.description}>
          {localDevelopment
            ? "Enter your name and email, choose your starting dashboard, and open the one-time sign-in link printed in the development server terminal. You can switch modes any time."
            : "Enter your name and email, choose your starting dashboard, and we’ll email you a one-time sign-in link. You can switch between Rider and Driver any time."}
        </p>
        <LoginForm enabled={enabled} localDevelopment={localDevelopment} />
        <p className={styles.notice}>
          A ride request is only confirmed after the driver accepts it.
        </p>
      </section>
    </main>
  );
}
