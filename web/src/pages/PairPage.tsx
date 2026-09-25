import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { pairingApi } from "../lib/api";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Spinner } from "../components/ui/Spinner";
import { Icon } from "../components/ui/Icon";
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
            setError("That code expired or doesn't exist.");
          }
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "Couldn't look up that code.");
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
      setError(err instanceof Error ? err.message : "Couldn't connect this device. Try again.");
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

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        {approved ? (
          <div className={styles.successBox}>
            <div className={styles.successIcon}><Icon name="check" size={24} /></div>
            <h1 className={styles.title}>Connected</h1>
            <p className={styles.subtitle}>
              {info?.deviceName || "Your device"} is on @{user?.username}. Head back to your {osLabel}.
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
            <p className={styles.subtitle}>Looking up code…</p>
          </div>
        ) : !info?.valid ? (
          <div className={styles.header}>
            <h1 className={styles.title}>Pair a device</h1>
            <p className={styles.subtitle}>Enter the code the VibeHub app shows you.</p>
            {error && <p className={styles.error} role="alert">{error}</p>}
            <form onSubmit={handleManualSubmit} className={styles.inputGroup}>
              <Input
                className={styles.codeInput}
                placeholder="VIBE-XXXX"
                value={inputCode}
                onChange={(e) => setInputCode(e.target.value)}
                maxLength={16}
                autoFocus
                aria-label="Pairing code"
                autoComplete="off"
                spellCheck={false}
              />
              <Button type="submit" disabled={!inputCode.trim()}>Continue</Button>
            </form>
          </div>
        ) : (
          <>
            <div className={styles.header}>
              <h1 className={styles.title}>Connect this {osLabel}?</h1>
              <p className={styles.subtitle}>It will show your AI coding sessions here.</p>
            </div>

            <div className={styles.deviceBox}>
              <div className={styles.deviceMeta}>
                <span className={styles.deviceName}>{info.deviceName || "Personal Computer"}</span>
                <span className={styles.deviceOs}>{info.os || "Desktop"}</span>
              </div>
              <span className={styles.codeBadge}>{info.userCode}</span>
            </div>

            <p className={styles.summary}>
              Reads local AI session logs only. Prompts, code and files never leave the device.
            </p>

            {error && (
              <p className={styles.error} role="alert">{error}</p>
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
                What gets sent <Icon name="chevronDown" size={12} />
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
