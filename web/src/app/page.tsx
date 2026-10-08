import Link from "next/link";
import styles from "./pilot-home.module.css";

const authEnabled = process.env.AUTH_ENABLED === "true";

export default function Home() {
  return (
    <main className={styles.shell}>
      <header className={styles.topbar}>
        <Link className={styles.brand} href="/" aria-label="Carpool home">
          <span className={styles.brandMark} aria-hidden="true">c</span>
          <span>commute<span className={styles.brandDot}>.</span></span>
        </Link>
        {authEnabled ? <Link className={styles.signIn} href="/login">Sign in / Sign up</Link> : <span className={styles.status}>Sign-in setup in progress</span>}
      </header>

      <section className={styles.hero}>
        <p className={styles.eyebrow}><span /> CARPOOL PAKISTAN</p>
        <h1>Share your commute<br /><em>on your terms.</em></h1>
        <p className={styles.description}>
          Find a ride for a specific date or offer a seat on a trip you’re already taking. Create an account, then switch between Rider and Driver whenever you need.
        </p>
        <div className={styles.callout}>
          <span className={styles.calloutIcon} aria-hidden="true">i</span>
          <div>
            <strong>{authEnabled ? "One account, either role" : "Sign-in is being configured"}</strong>
            <p>{authEnabled
              ? "Choose Rider or Driver as your starting view. You can change modes from your dashboard; a seat is reserved only after a driver accepts your request."
              : "Account creation will be available after sign-in has been configured."}</p>
          </div>
        </div>
        {authEnabled && <Link className={styles.primaryAction} href="/login">Create account or sign in <span aria-hidden="true">→</span></Link>}
      </section>

      <footer className={styles.footer}>
        <span>Rider and Driver modes</span>
        <span>Lahore · Pakistan</span>
      </footer>
    </main>
  );
}
