import type { RepoDigest } from "../../types";
import { formatCount } from "../../lib/format";
import { languagePercent, languageShade } from "../../lib/repoLanguages";
import { Skeleton } from "../ui/Skeleton";
import styles from "./ProjectDigest.module.css";

export function ProjectDigestSkeleton() {
  return (
    <div className={styles.meta} aria-label="Repository details" aria-busy="true">
      <div className={styles.row}>
        <Skeleton variant="pill" width={58} height={21} />
        <Skeleton variant="pill" width={86} height={21} />
      </div>
      <Skeleton width="100%" height={4} />
    </div>
  );
}

/** Only repo facts that earn their space; pushes already own the last-updated line. */
export function ProjectDigest({ digest }: { digest: RepoDigest }) {
  const languages = (digest.languages ?? []).filter((l) => l.share > 0 && Number.isFinite(l.share)).slice(0, 4);
  const languageIndex = Math.max(0, languages.findIndex((l) => l.name === digest.language));
  const topics = [...new Set(digest.topics.filter((topic) => topic.trim()))].slice(0, 4);
  const license = digest.license && digest.license !== "NOASSERTION" ? digest.license : null;
  const hasMeta = digest.stars > 0 || digest.language || topics.length > 0 || license;
  if (!hasMeta && languages.length === 0) return null;
  const shares = languages.map((l) => `${l.name} ${languagePercent(l.share)}`).join(", ");

  return (
    <div className={styles.meta}>
      {hasMeta && (
        <div className={styles.row} aria-label="Repository details">
          {digest.stars > 0 && (
            <span className={[styles.chip, styles.stat].join(" ")} title={`${digest.stars.toLocaleString("en-US")} GitHub stars`}>
              <span aria-hidden="true">★</span>
              <span aria-label={`${digest.stars} GitHub stars`}>{formatCount(digest.stars)}</span>
            </span>
          )}
          {digest.language && (
            <span className={[styles.chip, styles.stat].join(" ")}>
              <span className={styles.dot} style={{ opacity: languageShade(languageIndex) }} aria-hidden="true" />
              <span className={styles.label}>{digest.language}</span>
            </span>
          )}
          {topics.map((topic) => (
            <span className={styles.chip} key={topic}><span className={styles.label}>{topic}</span></span>
          ))}
          {license && <span className={styles.chip}><span className={styles.label}>{license}</span></span>}
        </div>
      )}
      {languages.length > 0 && (
        <div className={styles.bar} role="img" aria-label={shares} title={shares}>
          {languages.map((language, i) => (
            <span
              key={language.name}
              className={styles.band}
              style={{ width: `${Math.min(1, language.share) * 100}%`, opacity: languageShade(i) }}
              title={`${language.name} ${languagePercent(language.share)}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
