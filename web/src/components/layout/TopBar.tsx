import { NavLink } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useRealtime } from "../../context/RealtimeContext";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import styles from "./TopBar.module.css";

const NAV_ITEMS = [
  { to: "/", label: "Home", end: true },
  { to: "/friends", label: "Friends" },
  { to: "/projects", label: "Projects" },
];

export function TopBar() {
  const { user, logout } = useAuth();
  const { incomingRequests } = useRealtime();

  const navClass = ({ isActive }: { isActive: boolean }) =>
    [styles.navLink, isActive && styles.navLinkActive].filter(Boolean).join(" ");

  return (
    <header className={styles.bar}>
      <div className={styles.inner}>
        <NavLink to="/" className={styles.logo}>
          <span className={styles.logoMark} />
          VibeHub
        </NavLink>

        {user && (
          <nav className={styles.nav}>
            {NAV_ITEMS.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={navClass}>
                {item.label}
                {item.to === "/friends" && incomingRequests.length > 0 && (
                  <span className={styles.badgeDot} style={{ marginLeft: 6 }}>
                    {incomingRequests.length}
                  </span>
                )}
              </NavLink>
            ))}
          </nav>
        )}

        <div className={styles.spacer} />

        <div className={styles.right}>
          {user ? (
            <>
              <NavLink to="/settings" className={navClass}>
                Settings
              </NavLink>
              <NavLink to={`/u/${user.username}`} className={styles.profileLink}>
                <Avatar src={user.avatarUrl} name={user.displayName} size={28} />
                {user.displayName}
              </NavLink>
              <Button variant="ghost" onClick={() => logout()}>
                Log out
              </Button>
            </>
          ) : null}
        </div>
      </div>
    </header>
  );
}
