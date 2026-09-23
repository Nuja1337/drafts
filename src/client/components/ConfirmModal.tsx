// In-page confirmation dialog (no window.confirm). Optionally requires typing a phrase, e.g. the team name.
import { useEffect, useState, type ReactNode } from "react";
import { Button, ErrorNote, Input, Modal } from "../ui";

export function ConfirmModal({
  open,
  onClose,
  title,
  children,
  confirmLabel = "Confirm",
  tone = "danger",
  requireText,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children?: ReactNode;
  confirmLabel?: string;
  tone?: "danger" | "primary";
  /** When set, the confirm button stays disabled until this exact text is typed. */
  requireText?: string;
  /** Throw to keep the dialog open and show the error. */
  onConfirm: () => Promise<void> | void;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (open) {
      setTyped("");
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const matches = !requireText || typed.trim() === requireText.trim();

  const confirm = async () => {
    if (!matches || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      setBusy(false);
      onClose();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={() => !busy && onClose()} title={title}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void confirm();
        }}
      >
        {children && <div className="space-y-2 text-sm text-muted">{children}</div>}
        {requireText && (
          <label className="block space-y-1.5">
            <span className="text-xs text-muted">
              Type <span className="font-mono font-semibold text-text">{requireText}</span> to confirm
            </span>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus autoComplete="off" spellCheck={false} />
          </label>
        )}
        <ErrorNote error={error} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy} autoFocus={!requireText}>
            Cancel
          </Button>
          <Button type="submit" variant={tone} loading={busy} disabled={!matches}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
