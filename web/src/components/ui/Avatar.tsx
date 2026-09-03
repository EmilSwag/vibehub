import { initial } from "../../lib/format";
import styles from "./Avatar.module.css";

interface AvatarProps {
  src?: string | null;
  name: string;
  size?: number;
}

export function Avatar({ src, name, size = 40 }: AvatarProps) {
  const style = { width: size, height: size, fontSize: size * 0.42 };

  if (src) {
    return (
      <img className={styles.avatar} style={style} src={src} alt={name} width={size} height={size} />
    );
  }

  return (
    <div className={`${styles.avatar} ${styles.fallback}`} style={style} aria-label={name}>
      {initial(name)}
    </div>
  );
}
