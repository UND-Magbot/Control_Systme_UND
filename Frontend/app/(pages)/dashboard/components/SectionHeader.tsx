import type { ReactNode } from 'react';
import styles from './SectionHeader.module.css';

type SectionHeaderProps = {
    icon: string;
    title: string;
    rightSlot?: ReactNode;
};

export default function SectionHeader({ icon, title, rightSlot }: SectionHeaderProps) {
    return (
        <div className={styles.sectionHeader}>
            <div className={styles.titleGroup}>
                <div className={styles.iconWrapper}>
                    <img src={icon} alt="" />
                </div>
                <h2>{title}</h2>
            </div>
            {rightSlot}
        </div>
    );
}
