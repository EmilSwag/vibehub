import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useRealtime } from "../../context/RealtimeContext";
import { Avatar } from "../ui/Avatar";
import { Logo } from "../ui/Logo";
import { NavIcon } from "../ui/NavIcon";
import type { NavIconName } from "../ui/NavIcon";
import { PresenceBlock } from "../ui/PresenceBlock";
import { ThemeToggle } from "../ui/ThemeToggle";
import styles from "./TopBar.module.css";

interface NavItem {
  to: string;
  label: string;
  icon: NavIconName;
  end?: boolean;
}

/** ≤ 4 items (skills/emil_design_eng §1). Log out lives in the avatar menu. */
const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Home", icon: "home", end: true },
  { to: "/friends", label: "Friends", icon: "friends" },
  { to: "/projects", label: "Projects", icon: "projects" },
];

const MENU_ID = "vh-account-menu";
const MENU_ITEM_SELECTOR = '[role="menuitem"]';

/**
 * Minimal shell chrome: three segmented tabs, the theme switch and one avatar
 * button. Profile / Settings / Log out live in the avatar menu, which follows
 * the WAI-ARIA menu-button pattern (arrow keys move, Enter/Space activate,
 * Escape/Tab/outside-click close, focus returns to the button).
 */
export function TopBar() {
  const { user, logout } = useAuth();
  const { incomingRequests, presences } = useRealtime();
  const [menuOpen, setMenuOpen] = useState(false);
  // The mark runs its loop only while the home link is hovered or focused, so the
  // chrome stays still (skills/emil_design_eng §4: motion has to say something).
  const [logoLive, setLogoLive] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const avatarButtonRef = useRef<HTMLButtonElement | null>(null);
  // Whether closing should hand focus back to the avatar button. Outside clicks
  // opt out — the click already moved focus wherever the user pointed.
  const restoreFocusRef = useRef(true);
  const wasOpenRef = useRef(false);
  const location = useLocation();

  const openMenu = useCallback(() => {
    restoreFocusRef.current = true;
    setMenuOpen(true);
  }, []);

  const closeMenu = useCallback((restoreFocus = true) => {
    restoreFocusRef.current = restoreFocus;
    setMenuOpen(false);
  }, []);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || avatarButtonRef.current?.contains(target)) return;
      closeMenu(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu(true);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen, closeMenu]);

  // Close on navigation (an item was activated, or the route changed underneath).
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  // Focus management: first item on open, avatar button on close.
  useEffect(() => {
    if (menuOpen) {
      wasOpenRef.current = true;
      menuRef.current?.querySelector<HTMLElement>(MENU_ITEM_SELECTOR)?.focus();
      return;
    }
    if (!wasOpenRef.current) return;
    wasOpenRef.current = false;
    if (restoreFocusRef.current) avatarButtonRef.current?.focus();
  }, [menuOpen]);

  const onMenuKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR) ?? []);
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    const focusAt = (i: number) => items[((i % items.length) + items.length) % items.length]?.focus();

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        focusAt(current + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        focusAt(current === -1 ? items.length - 1 : current - 1);
        break;
      case "Home":
        e.preventDefault();
        focusAt(0);
        break;
      case "End":
        e.preventDefault();
        focusAt(items.length - 1);
        break;
      case "Tab":
        // Leaving the menu closes it; focus goes back to the button so the tab
        // order continues from where the menu was opened.
        e.preventDefault();
        closeMenu(true);
        break;
      case " ": {
        // Buttons activate on Space natively; links do not.
        const target = e.target as HTMLElement;
        if (target.tagName === "A") {
          e.preventDefault();
          target.click();
        }
        break;
      }
      default:
        break;
    }
  };

  const onAvatarKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      openMenu();
    }
  };

  const navClass = ({ isActive }: { isActive: boolean }) =>
    [styles.navLink, isActive && styles.navLinkActive].filter(Boolean).join(" ");

  const pending = incomingRequests.length;

  return (
    <header className={styles.bar}>
      <div className={styles.inner}>
        <NavLink
          to="/"
          className={styles.logo}
          aria-label="VibeHub home"
          onMouseEnter={() => setLogoLive(true)}
          onMouseLeave={() => setLogoLive(false)}
          onFocus={() => setLogoLive(true)}
          onBlur={() => setLogoLive(false)}
        >
          <Logo size={20} animated={logoLive} />
          <span className={styles.logoText}>VibeHub</span>
        </NavLink>

        {user && (
          <nav className={styles.nav} aria-label="Primary">
            {NAV_ITEMS.map((item) => {
              const isFriends = item.to === "/friends";
              const name =
                isFriends && pending > 0 ? `${item.label}, ${pending} ${pending === 1 ? "request" : "requests"}` : item.label;
              return (
                <NavLink key={item.to} to={item.to} end={item.end} className={navClass} aria-label={name}>
                  <NavIcon name={item.icon} size={16} className={styles.navIcon} />
                  <span className={styles.navLabel}>{item.label}</span>
                  {isFriends && pending > 0 && (
                    <span className={styles.badgeDot} aria-hidden="true">
                      {pending}
                    </span>
                  )}
                </NavLink>
              );
            })}
          </nav>
        )}

        <div className={styles.right}>
          <ThemeToggle />

          {user && (
            <>
              <button
                ref={avatarButtonRef}
                type="button"
                className={styles.avatarButton}
                onClick={() => (menuOpen ? closeMenu(true) : openMenu())}
                onKeyDown={onAvatarKeyDown}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-controls={menuOpen ? MENU_ID : undefined}
                aria-label="Account menu"
              >
                <Avatar src={user.avatarUrl} name={user.displayName} size={30} />
              </button>

              {menuOpen && (
                <div
                  id={MENU_ID}
                  ref={menuRef}
                  className={styles.menu}
                  role="menu"
                  aria-label="Account"
                  onKeyDown={onMenuKeyDown}
                >
                  <div className={styles.menuHeader}>
                    <span className={styles.menuName}>{user.displayName}</span>
                    <span className={styles.menuHandle}>@{user.username}</span>
                    <PresenceBlock
                      presence={presences.get(user.username)}
                      variant="compact"
                      showElapsed={false}
                      className={styles.menuPresence}
                    />
                  </div>
                  <Link to={`/u/${user.username}`} role="menuitem" className={styles.menuItem}>
                    <NavIcon name="user" size={16} className={styles.menuIcon} />
                    Profile
                  </Link>
                  <Link to="/settings" role="menuitem" className={styles.menuItem}>
                    <NavIcon name="settings" size={16} className={styles.menuIcon} />
                    Settings
                  </Link>
                  <div className={styles.menuDivider} role="separator" />
                  <button
                    type="button"
                    role="menuitem"
                    className={styles.menuItem}
                    onClick={() => {
                      closeMenu(false);
                      void logout();
                    }}
                  >
                    <NavIcon name="logout" size={16} className={styles.menuIcon} />
                    Log out
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </header>
  );
}
