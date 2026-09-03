import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useRealtime } from "../../context/RealtimeContext";
import { Avatar } from "../ui/Avatar";
import styles from "./TopBar.module.css";

const NAV_ITEMS = [
  { to: "/", label: "Home", end: true },
  { to: "/friends", label: "Friends" },
  { to: "/projects", label: "Projects" },
];

/**
 * Minimal shell chrome (skills/emil_design_eng §1): three segmented tabs and one
 * avatar button. Profile / Settings / Log out live in the avatar menu.
 */
export function TopBar() {
  const { user, logout } = useAuth();
  const { incomingRequests } = useRealtime();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const location = useLocation();

  // Close on outside click / Escape / navigation.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);
  useEffect(() => setMenuOpen(false), [location.pathname]);

  const navClass = ({ isActive }: { isActive: boolean }) =>
    [styles.navLink, isActive && styles.navLinkActive].filter(Boolean).join(" ");

  return (
    <header className={styles.bar}>
      <div className={styles.inner}>
        <NavLink to="/" className={styles.logo} aria-label="VibeHub home">
          <span className={styles.logoMark} />
          <span className={styles.logoText}>VibeHub</span>
        </NavLink>

        {user && (
          <nav className={styles.nav} aria-label="Primary">
            {NAV_ITEMS.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={navClass}>
                {item.label}
                {item.to === "/friends" && incomingRequests.length > 0 && (
                  <span className={styles.badgeDot}>{incomingRequests.length}</span>
                )}
              </NavLink>
            ))}
          </nav>
        )}

        <div className={styles.right} ref={menuRef}>
          {user ? (
            <>
              <button
                type="button"
                className={styles.avatarButton}
                onClick={() => setMenuOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label="Account menu"
              >
                <Avatar src={user.avatarUrl} name={user.displayName} size={30} />
              </button>

              {menuOpen && (
                <div className={[styles.menu, "scale-in"].join(" ")} role="menu">
                  <div className={styles.menuHeader}>
                    <span className={styles.menuName}>{user.displayName}</span>
                    <span className={styles.menuHandle}>@{user.username}</span>
                  </div>
                  <Link to={`/u/${user.username}`} role="menuitem" className={styles.menuItem}>
                    Profile
                  </Link>
                  <Link to="/settings" role="menuitem" className={styles.menuItem}>
                    Settings
                  </Link>
                  <button type="button" role="menuitem" className={styles.menuItem} onClick={() => logout()}>
                    Log out
                  </button>
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
    </header>
  );
}
