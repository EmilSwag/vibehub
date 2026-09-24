import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { pairingApi } from "../lib/api";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Spinner } from "../components/ui/Spinner";
import { TRACKER_FULL_DISCLOSURE } from "../lib/connectPrompt";
import styles from "./PairPage.module.css";

interface DeviceInfo {
  valid: boolean;
  userCode?: string;
  deviceName?: string;
  os?: "mac" | "windows" | "linux" | "unknown";
  expiresAt?: number;
  alreadyApproved?: boolean;
}

export function PairPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const codeParam = (params.get("code") ?? "").trim().toUpperCase();
  const [inputCode, setInputCode] = useState(codeParam);
  const [activeCode, setActiveCode] = useState(codeParam);

  const [loading, setLoading] = useState(Boolean(codeParam));
  const [info, setInfo] = useState<DeviceInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [approved, setApproved] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    if (!activeCode) {
      setLoading(false);
      setInfo(null);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    pairingApi
      .info(activeCode, controller.signal)
      .then((res) => {
        if (!controller.signal.aborted) {
          if (res.valid) {
            setInfo(res);
          } else {
            setError("This pairing code has expired or is invalid.");
          }
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "Could not look up pairing code.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [activeCode]);

  const handleApprove = async () => {
    if (!activeCode || approving) return;
    setApproving(true);
    setError(null);
    try {
      await pairingApi.approve(activeCode);
      setApproved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not approve device pairing.");
    } finally {
      setApproving(false);
    }
  };

  const handleManualSubmit = (e: FormEvent) => {
    e.preventDefault();
    const clean = inputCode.trim().toUpperCase();
    if (clean) {
      setActiveCode(clean);
    }
  };

  const osLabel = info?.os === "mac" ? "Mac" : info?.os === "windows" ? "PC" : "device";
  const osGlyph = info?.os === "mac" ? "" : info?.os === "windows" ? "⊞" : "💻";

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        {approved ? (
          <div className={styles.successBox}>
            <div className={styles.successIcon}>✓</div>
            <h1 className={styles.successTitle}>Connected</h1>
            <p className={styles.successSub}>
              {info?.deviceName || "Your device"} is now connected to @{user?.username}. You can return to VibeHub on your {osLabel}.
            </p>
            <Button
              className={styles.approveBtn}
              onClick={() => navigate("/")}
            >
              Done
            </Button>
          </div>
        ) : loading ? (
          <div className={styles.successBox}>
            <Spinner size={24} />
            <p className={styles.subtitle}>Looking up pairing request…</p>
          </div>
        ) : !info?.valid ? (
          <div className={styles.header}>
            <h1 className={styles.title}>Pair a device</h1>
            <p className={styles.subtitle}>
              Enter the pairing code shown in VibeHub on your Mac or PC.
            </p>
            {error && <p className={styles.subtitle} style={{ color: "var(--text-error)" }}>{error}</p>}
            <form onSubmit={handleManualSubmit} className={styles.inputGroup} style={{ marginTop: "1rem" }}>
              <Input
                className={styles.codeInput}
                placeholder="VIBE-XXXX"
                value={inputCode}
                onChange={(e) => setInputCode(e.target.value)}
                maxLength={16}
                autoFocus
              />
              <Button type="submit">Lookup</Button>
            </form>
          </div>
        ) : (
          <>
            <div className={styles.header}>
              <h1 className={styles.title}>Connect this {osLabel}?</h1>
              <p className={styles.subtitle}>
                Pairing allows VibeHub to track your AI coding sessions on this device.
              </p>
            </div>

            <div className={styles.deviceBox}>
              <span className={styles.deviceIcon}>{osGlyph}</span>
              <div className={styles.deviceMeta}>
                <span className={styles.deviceName}>{info.deviceName || "Personal Computer"}</span>
                <span className={styles.deviceOs}>{info.os || "Desktop"}</span>
              </div>
              <span className={styles.codeBadge}>{info.userCode}</span>
            </div>

            <p className={styles.summary}>
              Reads only supported local AI logs. No prompts, code, files or transcripts ever leave your machine.
            </p>

            {error && (
              <p className={styles.subtitle} style={{ color: "var(--text-error)" }}>
                {error}
              </p>
            )}

            <div className={styles.actions}>
              <Button
                className={styles.approveBtn}
                onClick={handleApprove}
                disabled={approving}
              >
                {approving ? "Connecting…" : `Allow this ${osLabel}`}
              </Button>
              <Button
                variant="secondary"
                className={styles.cancelBtn}
                onClick={() => navigate("/")}
                disabled={approving}
              >
                Cancel
              </Button>
            </div>

            <div>
              <button
                type="button"
                className={styles.detailsToggle}
                onClick={() => setDetailsOpen(!detailsOpen)}
                aria-expanded={detailsOpen}
              >
                {detailsOpen ? "Hide details ▲" : "View privacy & data details ▼"}
              </button>
              {detailsOpen && (
                <div className={styles.detailsBox}>
                  {TRACKER_FULL_DISCLOSURE}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
