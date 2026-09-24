import { useEffect, useRef, useState } from "react";
import type { MouseEvent, KeyboardEvent } from "react";
import { Icon } from "./ui/Icon";
import styles from "./FriendRowMenu.module.css";

interface FriendRowMenuProps {
  username: string;
  onUnfriend: (username: string) => void | Promise<void>;
}

export function FriendRowMenu({ username, onUnfriend }: FriendRowMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const toggle = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsOpen((prev) => {
      if (prev) setConfirming(false);
      return !prev;
    });
  };

  const handleUnfriend = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setIsOpen(false);
    setConfirming(false);
    void onUnfriend(username);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setIsOpen(false);
      setConfirming(false);
      buttonRef.current?.focus();
    }
  };

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: Event) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setConfirming(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [isOpen]);

  return (
    <div className={styles.wrapper} ref={menuRef} onKeyDown={handleKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.trigger}
        onClick={toggle}
        aria-label={`Options for @${username}`}
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        <Icon name="moreHorizontal" size={16} />
      </button>

      {isOpen && (
        <div className={styles.dropdown} role="menu">
          <button
            type="button"
            role="menuitem"
            className={styles.menuItem}
            onClick={handleUnfriend}
          >
            <Icon name="trash" size={13} className={styles.menuIcon} />
            <span>{confirming ? "Confirm unfriend" : "Unfriend"}</span>
          </button>
        </div>
      )}
    </div>
  );
}
