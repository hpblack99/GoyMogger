import { Link, useLocation } from 'react-router-dom'
import styles from './Navbar.module.css'

export default function Navbar() {
  const location = useLocation()

  return (
    <header className={styles.header}>
      <nav className={styles.nav}>
        <Link to="/" className={styles.logo}>
          App
        </Link>
        <div className={styles.links}>
          <Link
            to="/"
            className={`${styles.link} ${location.pathname === '/' ? styles.active : ''}`}
          >
            Home
          </Link>
        </div>
      </nav>
    </header>
  )
}
