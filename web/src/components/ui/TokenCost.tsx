import { presentTokenCost, TOKEN_COST_LIMITATIONS } from "../../lib/tokenCost";
import type { TokenCostEstimate } from "../../lib/tokenCost";
import { TOKEN_PRICING_CHECKED_AT, TOKEN_PRICING_SOURCES } from "../../lib/tokenPricing";
import styles from "./TokenCost.module.css";

interface Props {
  estimate: TokenCostEstimate;
  /** A row button can describe itself with this text without nesting a control. */
  id?: string;
}

/** Text only: safe inside a StatTile button and an aria-hidden tool-detail row. */
export function TokenCost({ estimate, id }: Props) {
  const text = presentTokenCost(estimate);
  return (
    <span className={styles.cost} data-token-cost={estimate.status} title={text.description}>
      <span className={styles.amount} aria-hidden="true">{text.amount}</span>
      {text.coverage && <span className={styles.coverage} aria-hidden="true">{text.coverage}</span>}
      <span id={id} className={styles.srOnly}>{text.description}</span>
    </span>
  );
}

/** One disclosure per block, OUTSIDE existing buttons and collapsed tool details. */
export function TokenCostDetails() {
  return (
    <details className={styles.details} data-token-cost-details>
      <summary>API estimate</summary>
      <div className={styles.explanation}>
        <p>{TOKEN_COST_LIMITATIONS}</p>
        <p>
          Rates checked <time dateTime={TOKEN_PRICING_CHECKED_AT}>{TOKEN_PRICING_CHECKED_AT}</time>.{" "}
          <a href={TOKEN_PRICING_SOURCES.openai} target="_blank" rel="noreferrer">OpenAI pricing (new tab)</a>
          {" · "}
          <a href={TOKEN_PRICING_SOURCES.anthropic} target="_blank" rel="noreferrer">Anthropic pricing (new tab)</a>
        </p>
      </div>
    </details>
  );
}
