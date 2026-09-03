import { useState } from "react";
import styles from "./ProjectGallery.module.css";

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

/**
 * Full-size gallery for the project page: the main frame never crops (fitted,
 * not covered) so screenshots of any aspect ratio stay whole; a thumbnail strip
 * switches between shots when there's more than one.
 */
export function ProjectGallery({ images, alt }: { images: string[]; alt: string }) {
  const [active, setActive] = useState(0);
  if (images.length === 0) return null;
  const current = images[Math.min(active, images.length - 1)];

  return (
    <div className={styles.wrap}>
      <div className={styles.frame}>
        <img key={current} className={styles.main} src={current} alt={alt} />
      </div>
      {images.length > 1 && (
        <div className={styles.strip} role="tablist" aria-label="Screenshots">
          {images.map((url, i) => (
            <button
              key={url}
              type="button"
              role="tab"
              aria-selected={i === active}
              className={cx(styles.thumb, i === active && styles.thumbActive)}
              onClick={() => setActive(i)}
            >
              <img src={url} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
