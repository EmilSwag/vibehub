import { useId, useRef, useState } from "react";
import {
  HOOKS_CLI_REQUIREMENT,
  HOOKS_DRY_RUN,
  HOOKS_REPORTS,
  HOOKS_REVERSIBLE,
  HOOKS_SCOPE,
  HOOKS_TITLE,
  HOOKS_WRITES,
  buildHooksCommand,
} from "../../lib/connectPrompt";
import type { HookVerb } from "../../lib/connectPrompt";
import { HOOK_TOOLS } from "../../lib/supportedTools";
import { toolLabel } from "../../lib/format";
import { Button } from "../ui/Button";
import { ToolGlyph } from "../ui/ToolGlyph";
import styles from "./HookTools.module.css";

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

/**
 * The opt-in for the tools that have no log to read.
 *
 * Secondary by construction: a closed disclosure under the primary install command,
 * never a second thing to do on first connect. Inside, one command is visible at a
 * time — a verb picker, the same control the OS chooser already is — because three
 * commands per tool is a wall, and the reader only ever wants one of them.
 *
 * Copy state is local: the two hosts (the connect sheet and Settings Add device)
 * already track their own primary-command copy, and this block must not widen either
 * of their unions to get a checkmark of its own.
 */

/** `dryRun` rides on `install`; the CLI has no separate preview verb. */
const VERBS: { id: HookVerb; label: string; dryRun: boolean; action: string }[] = [
  { id: "install", label: "Install", dryRun: false, action: "install" },
  { id: "install", label: "Preview", dryRun: true, action: "preview" },
  { id: "uninstall", label: "Remove", dryRun: false, action: "remove" },
];

interface Props {
  className?: string;
}

export function HookTools({ className }: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [verb, setVerb] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const generation = useRef(0);

  const chosen = VERBS[verb];

  const copy = async (what: string, text: string) => {
    const mine = ++generation.current;
    setCopied(null);
    setFailed(null);
    try {
      await navigator.clipboard.writeText(text);
      if (generation.current !== mine) return;
      setCopied(what);
    } catch {
      if (generation.current === mine) setFailed(what);
    }
  };

  const line = (what: string, label: string, command: string) => (
    <>
      <pre className={styles.cmd} tabIndex={0} aria-label={`${label} command`}>{command}</pre>
      <Button variant="secondary" className={styles.copy} onClick={() => void copy(what, command)}>
        {copied === what ? "Command copied" : `Copy ${label.toLowerCase()}`}
      </Button>
      {failed === what && <p className={styles.error} role="alert">Copy failed — select and copy the text above.</p>}
    </>
  );

  return (
    <div className={cx(styles.block, className)}>
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={open}
        aria-controls={`${id}-hooks`}
        onClick={() => setOpen((value) => !value)}
      >
        {HOOKS_TITLE}
      </button>
      {open && (
        <div id={`${id}-hooks`} className={cx(styles.body, "fade-in")}>
          <p className={styles.explain}>{HOOKS_SCOPE}</p>
          <p className={styles.explain}>{HOOKS_REPORTS}</p>
          <p className={styles.explain}>{HOOKS_WRITES}</p>

          <div className={styles.seg} role="group" aria-label="Hook command">
            {VERBS.map((option, index) => (
              <button
                key={option.action}
                type="button"
                aria-pressed={verb === index}
                className={cx(styles.segBtn, verb === index && styles.segBtnOn)}
                onClick={() => { setVerb(index); setCopied(null); setFailed(null); }}
              >
                {option.label}
              </button>
            ))}
          </div>

          <ul className={styles.tools}>
            {HOOK_TOOLS.map((tool) => {
              const label = `${toolLabel(tool.id)} ${chosen.label.toLowerCase()}`;
              return (
                <li key={tool.id} className={styles.tool}>
                  <span className={styles.toolName}>
                    <ToolGlyph family={tool.id} size={16} className={styles.toolGlyph} />
                    {toolLabel(tool.id)}
                  </span>
                  {line(`${tool.id}-${chosen.action}`, label, buildHooksCommand(chosen.id, tool.id, chosen.dryRun))}
                </li>
              );
            })}
          </ul>

          <p className={styles.explain}>{chosen.dryRun ? HOOKS_DRY_RUN : HOOKS_REVERSIBLE}</p>

          <div className={styles.tool}>
            <span className={styles.toolName}>What is installed</span>
            {line("status", "Hook status", buildHooksCommand("status"))}
          </div>

          <p className={styles.note}>{HOOKS_CLI_REQUIREMENT}</p>
        </div>
      )}
    </div>
  );
}
