import { Link, useLocation } from 'react-router-dom'
import styles from './Navbar.module.css'

export default function Navbar() {
  const location = useLocation()

  const active = (path: string) =>
    location.pathname === path ? styles.active : ''

  return (
    <header className={styles.header}>
      <nav className={styles.nav}>
        <Link to="/" className={styles.logo}>
          GoyMogger
        </Link>
        <div className={styles.links}>
          <Link to="/" className={`${styles.link} ${active('/')}`}>
            Home
          </Link>
          <Link to="/quoter" className={`${styles.link} ${active('/quoter')}`}>
            FFE Quote Bot
          </Link>
        </div>
      </nav>
    </header>
  )
}
