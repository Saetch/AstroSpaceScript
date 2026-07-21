import { useEffect, useRef, useState } from "react";

type Props = {
  playerName: string;
  loggingOut?: boolean;
  onLogout: () => void;
};

export function AuthTopBar({
  playerName,
  loggingOut = false,
  onLogout,
}: Props) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function closeOnOutsideClick(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="auth-menu" ref={menuRef}>
      <button
        className="auth-menu-trigger"
        type="button"
        aria-expanded={open}
        aria-controls="auth-account-menu"
        onClick={() => setOpen((current) => !current)}
      >
        <span>Perseus</span>
        <span
          className={`auth-menu-arrow${open ? " auth-menu-arrow-open" : ""}`}
          aria-hidden="true"
        >
          ▾
        </span>
      </button>

      {open && (
        <div
          className="auth-menu-panel"
          id="auth-account-menu"
          role="dialog"
          aria-label="Perseus account"
        >
          <div className="auth-menu-status">
            <span className="auth-menu-dot" aria-hidden="true" />
            <span>Signed in</span>
          </div>

          <strong className="auth-menu-name" title={playerName}>
            {playerName}
          </strong>

          <button
            className="auth-menu-logout"
            disabled={loggingOut}
            type="button"
            onClick={onLogout}
          >
            {loggingOut ? "Logging out…" : "Logout"}
          </button>
        </div>
      )}
    </div>
  );
}
