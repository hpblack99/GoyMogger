import { Link, useLocation } from 'react-router-dom'
import styles from './Navbar.module.css'

export default function Navbar() {
  const { pathname } = useLocation()

  const active = (path: string) =>
    pathname === path || (path !== '/' && pathname.startsWith(path))
      ? styles.active
      : ''

  return (
    <header className={styles.header}>
      <nav className={styles.nav}>
        <Link to="/" className={styles.logo}>
          FFE Quote Bot
        </Link>
        <div className={styles.links}>
          <Link to="/" className={`${styles.link} ${active('/')}`}>
            Dashboard
          </Link>
          <Link to="/jobs" className={`${styles.link} ${active('/jobs')}`}>
            Jobs
          </Link>
          <Link to="/quoter" className={`${styles.link} ${styles.linkCta} ${active('/quoter')}`}>
            + New Job
          </Link>
        </div>
      </nav>
    </header>
  )
}
