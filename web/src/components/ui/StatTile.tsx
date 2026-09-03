import styles from "./StatTile.module.css";

export function StatTile({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className={styles.tile}>
      <span className={[styles.value, highlight && styles.highlight].filter(Boolean).join(" ")}>
        {value}
      </span>
      <span className={styles.label}>{label}</span>
    </div>
  );
}
