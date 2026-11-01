"use client";

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type FormEvent,
} from "react";
import { X, LoaderCircle, AlertCircle } from "lucide-react";
import type { TaskView } from "@/shared/types";

export class RequestError extends Error {
  field?: string;
  status: number;
  constructor(message: string, status: number, field?: string) {
    super(message);
    this.status = status;
    this.field = field;
  }
}
export async function api<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    cache: "no-store",
    signal,
    ...(body !== undefined
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const data = await response
    .json()
    .catch(() => ({
      error: "The server returned an unreadable response. Please try again.",
    }));
  if (!response.ok) {
    if (
      response.status === 401 &&
      !path.startsWith("/api/auth/") &&
      path !== "/api/session" &&
      typeof window !== "undefined"
    )
      window.dispatchEvent(new Event("session-expired"));
    throw new RequestError(
      data.error || "Something went wrong. Please try again.",
      response.status,
      data.field,
    );
  }
  return data as T;
}
export function useResource<T>(path: string | null, version = 0) {
  const [state, setState] = useState<{
    path: string | null;
    data: T | null;
    error: string;
    loading: boolean;
  }>({ path, data: null, error: "", loading: !!path });
  const latest = useRef(0);
  useEffect(() => {
    const id = ++latest.current;
    if (!path) {
      setState({ path, data: null, error: "", loading: false });
      return;
    }
    const controller = new AbortController();
    setState((old) => ({
      path,
      data: old.path === path ? old.data : null,
      error: "",
      loading: true,
    }));
    api<T>(path, undefined, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted && id === latest.current)
          setState({ path, data, error: "", loading: false });
      })
      .catch((error) => {
        if (!controller.signal.aborted && id === latest.current)
          setState((old) => ({
            path,
            data:
              old.path === path &&
              !(
                error instanceof RequestError &&
                [401, 403, 404].includes(error.status)
              )
                ? old.data
                : null,
            error: error.message || "Could not connect. Try again.",
            loading: false,
          }));
      });
    return () => controller.abort();
  }, [path, version]);
  // Never expose cached data from a different party, member, date, or account.
  return state.path === path
    ? state
    : { path, data: null, error: "", loading: !!path };
}
export function useAction(refresh?: () => void) {
  const [error, setError] = useState<RequestError | null>(null);
  const [pending, setPending] = useState(false);
  const locked = useRef(false);
  async function run<T>(work: () => Promise<T>, success?: (value: T) => void) {
    if (locked.current) return;
    locked.current = true;
    setPending(true);
    setError(null);
    let succeeded = false;
    if (typeof window !== "undefined")
      window.dispatchEvent(new Event("mutation-start"));
    try {
      if (typeof navigator !== "undefined" && !navigator.onLine)
        throw new RequestError(
          "You’re offline. Your input is kept here. Reconnect, then try again.",
          0,
        );
      const result = await work();
      succeeded = true;
      refresh?.();
      success?.(result);
    } catch (error) {
      setError(
        error instanceof RequestError
          ? error
          : new RequestError(
              error instanceof Error
                ? error.message
                : "Could not save. Please try again.",
              0,
            ),
      );
    } finally {
      locked.current = false;
      setPending(false);
      if (typeof window !== "undefined")
        window.dispatchEvent(
          new CustomEvent("mutation-end", { detail: { success: succeeded } }),
        );
    }
  }
  return { error, pending, run };
}
export function ErrorMessage({ error }: { error?: string | Error | null }) {
  return error ? (
    <div className="error-message" role="alert">
      <AlertCircle size={18} aria-hidden="true" />
      <span>{typeof error === "string" ? error : error.message}</span>
    </div>
  ) : null;
}
export function Loading({ text = "Loading your space…" }: { text?: string }) {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={22} />
      {text}
    </div>
  );
}
export function Submit({
  pending,
  offline,
  children = "Save changes",
}: {
  pending: boolean;
  offline?: boolean;
  children?: ReactNode;
}) {
  return (
    <button
      className="button primary"
      type="submit"
      disabled={pending || offline}
    >
      {pending ? (
        <>
          <LoaderCircle size={17} className="spin" />
          Saving…
        </>
      ) : (
        children
      )}
    </button>
  );
}
export function Modal({
  title,
  children,
  close,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const el = root.current;
    const focusable = () =>
      Array.from(
        el?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
        ) || [],
      ).filter((node) => node.getClientRects().length > 0);
    (
      el?.querySelector<HTMLElement>("[data-autofocus]") ||
      focusable()[0] ||
      el
    )?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key === "Tab") {
        const items = focusable();
        const first = items[0];
        const last = items[items.length - 1];
        if (!first) {
          event.preventDefault();
          el?.focus();
        } else if (
          event.shiftKey &&
          (document.activeElement === first ||
            !el?.contains(document.activeElement))
        ) {
          event.preventDefault();
          last.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last ||
            !el?.contains(document.activeElement))
        ) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        className={`modal ${wide ? "modal-wide" : ""}`}
        ref={root}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="modal-header">
          <div>
            <span className="eyebrow">YOUR 1% SPACE</span>
            <h2>{title}</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={close}
            aria-label="Close dialog"
          >
            <X size={21} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
export function Form({
  children,
  onSubmit,
  className = "",
  pending = false,
}: {
  children: ReactNode;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  className?: string;
  pending?: boolean;
}) {
  const root = useRef<HTMLFormElement>(null);
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending) {
      const invalid = root.current?.querySelector<HTMLElement>(
        '[aria-invalid="true"]',
      );
      const alert = root.current?.querySelector<HTMLElement>('[role="alert"]');
      if (invalid) invalid.focus();
      else if (alert) {
        alert.tabIndex = -1;
        alert.focus();
      }
    }
    wasPending.current = pending;
  }, [pending]);
  return (
    <form
      ref={root}
      className={`form ${className}`}
      onSubmit={onSubmit}
      aria-busy={pending}
    >
      {children}
    </form>
  );
}
export function localDate(timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
export function dateLabel(date: string, long = false) {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: long ? "long" : "short",
    month: long ? "long" : "short",
    day: "numeric",
  });
}
export function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function quantity(value: number, type: string, unit: string) {
  if (type === "binary") return value >= 1 ? "Done" : "Not done";
  if (type === "duration") {
    const seconds = Math.floor(value);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const rest = seconds % 60;
    return hours
      ? `${hours}h ${minutes}m`
      : minutes
        ? `${minutes}m ${rest ? `${rest}s` : ""}`.trim()
        : `${rest}s`;
  }
  return `${Number(value.toFixed(2)).toLocaleString()} ${unit}`;
}
export function ProgressBar({
  value,
  label,
}: {
  value: number | null;
  label: string;
}) {
  return (
    <div
      className="progress-track"
      role="progressbar"
      aria-label={label}
      aria-valuenow={value === null ? undefined : Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={
        value === null ? "No tasks planned" : `${Math.round(value)}%`
      }
    >
      <span style={{ width: `${Math.min(100, Math.max(0, value || 0))}%` }} />
    </div>
  );
}
export function TaskReadOnly({ task }: { task: TaskView }) {
  return (
    <div className="shared-task">
      <div>
        <strong>{task.title}</strong>
        <small>{task.description}</small>
      </div>
      <div>
        <span>
          {quantity(task.value, task.type, task.unit)}
          {task.type !== "binary" && (
            <span className="muted">
              {" "}
              / {quantity(task.target, task.type, task.unit)}
            </span>
          )}
        </span>
        <ProgressBar value={task.percent} label={task.title} />
      </div>
    </div>
  );
}
