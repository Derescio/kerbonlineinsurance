import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Toast, type ToastProps } from "./Toast";

export interface ToastInput extends Pick<
  ToastProps,
  "tone" | "title" | "message" | "actionLabel" | "onAction"
> {
  /** Milliseconds before it goes. Default 5000; danger toasts stay until dismissed. */
  duration?: number;
}

interface ActiveToast extends ToastInput {
  id: number;
}

// Figma Feedback (4:9): "toasts confirm an action and auto-dismiss after 5s"
const DEFAULT_DURATION = 5000;

const ToastContext = createContext<((toast: ToastInput) => void) | null>(null);

/** Shows a toast: `const toast = useToast(); toast({ title: "Saved" })`. Needs a Toaster above it. */
export function useToast() {
  const show = useContext(ToastContext);
  if (!show) throw new Error("useToast() needs a <Toaster> above it (src/routes/__root.tsx)");
  return show;
}

/**
 * Provider plus the toast stack. The live regions are on the page from the start, because a
 * region that appears at the same moment as its message usually isn't announced. Danger toasts
 * go in an assertive region; everything else is polite.
 */
export function Toaster({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ActiveToast[]>([]);
  const nextId = useRef(0);

  const show = useCallback((toast: ToastInput) => {
    const id = nextId.current++;
    setToasts((current) => [...current, { ...toast, id }]);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const render = (assertive: boolean) =>
    toasts
      .filter((t) => (t.tone === "danger") === assertive)
      .map((t) => <ToastItem key={t.id} toast={t} onDismiss={dismiss} />);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="kb-toaster">
        <div className="kb-toaster__region" aria-live="polite" aria-relevant="additions">
          {render(false)}
        </div>
        <div className="kb-toaster__region" aria-live="assertive" aria-relevant="additions">
          {render(true)}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

/** One toast with its timer, paused while hovered or focused so it can be read and used. */
function ToastItem({ toast, onDismiss }: { toast: ActiveToast; onDismiss: (id: number) => void }) {
  const { id, duration, onAction, tone = "success", ...props } = toast;
  const [paused, setPaused] = useState(false);
  const remaining = useRef(tone === "danger" ? Infinity : (duration ?? DEFAULT_DURATION));

  useEffect(() => {
    if (paused || remaining.current === Infinity) return;
    const started = Date.now();
    const timer = setTimeout(() => onDismiss(id), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current -= Date.now() - started;
    };
  }, [paused, id, onDismiss]);

  return (
    <Toast
      {...props}
      tone={tone}
      onAction={
        onAction
          ? () => {
              onAction();
              onDismiss(id);
            }
          : undefined
      }
      onClose={() => onDismiss(id)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    />
  );
}
