import styles from './Setting.module.css';

export default function Page() {

    return (
      <div>
        <div className={styles.topPosition}>
            <h1>Setting</h1>
        </div>
        <div className={styles.container}>
            <img src="/icon/coming-soon.png" alt="Coming Soon" />
            <div className={styles.topTitle}>COMING SOON</div>
            <div className={styles.contentText}>We Are Preparing This Service</div>
        </div>
      </div>
    )
}