import styles from './HomePage.module.css'

export default function HomePage() {
  return (
    <div className={styles.page}>
      <div className={styles.hero}>
        <h1 className={styles.title}>Welcome</h1>
        <p className={styles.subtitle}>Your app is ready. Start building something great.</p>
      </div>
    </div>
  )
}
