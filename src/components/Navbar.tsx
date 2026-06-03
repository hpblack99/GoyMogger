import { Link, useLocation } from 'react-router-dom'
import styles from './Navbar.module.css'

export default function Navbar() {
  const { pathname } = useLocation()

  const active = (path: string) =>
    pathname === path || (path !== '/reefer' && pathname.startsWith(path))
      ? styles.active
      : ''

  return (
    <header className={styles.header}>
      <nav className={styles.nav}>
        <Link to="/" className={styles.logo}>
          ReeferByHank
        </Link>
        <div className={styles.links}>
          <Link to="/reefer" className={`${styles.link} ${active('/reefer')}`}>
            Dashboard
          </Link>
          <Link to="/reefer/jobs" className={`${styles.link} ${active('/reefer/jobs')}`}>
            Bids
          </Link>
          <Link to="/reefer/quoter" className={`${styles.link} ${styles.linkCta} ${active('/reefer/quoter')}`}>
            + New Bid
          </Link>
        </div>
      </nav>
    </header>
  )
}
