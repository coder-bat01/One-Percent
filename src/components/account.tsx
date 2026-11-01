"use client";

import { useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Globe2,
  LockKeyhole,
  LogOut,
  Sprout,
  Users,
} from "lucide-react";
import type { InvitePreview, Profile } from "@/shared/types";
import {
  api,
  ErrorMessage,
  Form,
  Modal,
  Submit,
  useAction,
  useResource,
} from "./ui";

export function TimezoneField({
  value,
  change,
}: {
  value: string;
  change: (value: string) => void;
}) {
  return (
    <label>
      Timezone
      <input
        required
        list="timezone-options"
        value={value}
        onChange={(event) => change(event.target.value)}
        placeholder="Europe/London"
        autoComplete="off"
      />
      <datalist id="timezone-options">
        {Array.from(
          new Set([
            value,
            "UTC",
            "America/New_York",
            "America/Chicago",
            "America/Denver",
            "America/Los_Angeles",
            "America/Toronto",
            "America/Sao_Paulo",
            "Europe/London",
            "Europe/Paris",
            "Europe/Berlin",
            "Africa/Johannesburg",
            "Asia/Dubai",
            "Asia/Kolkata",
            "Asia/Singapore",
            "Asia/Tokyo",
            "Australia/Sydney",
            "Pacific/Auckland",
          ]),
        ).map((zone) => (
          <option key={zone} value={zone} />
        ))}
      </datalist>
      <small>
        Your plan follows this timezone, wherever you are. Enter any valid IANA
        timezone.
      </small>
    </label>
  );
}
export function AuthScreen({
  authenticated,
  inviteToken,
  offline,
}: {
  authenticated: (user: Profile) => void;
  inviteToken: string;
  offline: boolean;
}) {
  const [mode, setMode] = useState<"register" | "login">("register");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [timezone, setTimezone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  );
  const action = useAction();
  const preview = useResource<InvitePreview>(
    inviteToken ? `/api/invites/${encodeURIComponent(inviteToken)}` : null,
  );
  return (
    <main className="auth-page">
      <section className="auth-story">
        <a href="/" className="wordmark" aria-label="1 percent home">
          1<span>%</span>
          <span className="brand-period">.</span>
        </a>
        <div className="auth-story-content">
          <span className="eyebrow">A LITTLE BETTER. EVERY DAY.</span>
          <h1>
            Big things start
            <br />
            with <span>small steps.</span>
          </h1>
          <p>
            Your own goals. A little daily effort. A circle that keeps you
            going.
          </p>
          <div className="auth-illustration" aria-hidden="true">
            <div className="step step-one">
              <span>01</span>
              <Sprout size={22} />
              <strong>Make it yours.</strong>
            </div>
            <div className="step step-two">
              <span>02</span>
              <Check size={22} />
              <strong>Show up.</strong>
            </div>
            <div className="step step-three">
              <span>03</span>
              <ArrowUpRight size={25} />
              <strong>Keep growing.</strong>
            </div>
          </div>
          <div className="auth-principles">
            <span>
              <LockKeyhole size={16} />
              Private by default
            </span>
            <span>
              <Users size={16} />
              Better together
            </span>
            <span>
              <Globe2 size={16} />
              At your pace
            </span>
          </div>
        </div>
        <p className="auth-footer">Not perfection. Just a little progress.</p>
      </section>
      <section className="auth-form-section">
        <div className="auth-form-wrap">
          {inviteToken && (
            <div className="invite-preview-banner">
              <Users size={22} />
              <div>
                {preview.data ? (
                  <>
                    <strong>You’re invited to {preview.data.partyName}</strong>
                    <p>
                      {preview.data.description || "Your people are waiting."}{" "}
                      Sign in first, then choose whether to join.
                    </p>
                  </>
                ) : (
                  <p>{preview.error || "Opening your invitation…"}</p>
                )}
              </div>
            </div>
          )}
          <div className="auth-tabs">
            <button
              aria-pressed={mode === "register"}
              onClick={() => setMode("register")}
            >
              Create account
            </button>
            <button
              aria-pressed={mode === "login"}
              onClick={() => setMode("login")}
            >
              Sign in
            </button>
          </div>
          <span className="eyebrow">YOUR NEXT CHAPTER</span>
          <h2>{mode === "register" ? "Start with you." : "Welcome back."}</h2>
          <p className="muted">
            {mode === "register"
              ? "A little space for the person you’re becoming."
              : "Your next small step is waiting."}
          </p>
          <Form
            pending={action.pending}
            onSubmit={(event) => {
              event.preventDefault();
              void action.run(
                () =>
                  api<{ user: Profile }>(`/api/auth/${mode}`, {
                    email,
                    password,
                    ...(mode === "register" ? { name, timezone } : {}),
                  }),
                (data) => authenticated(data.user),
              );
            }}
          >
            <ErrorMessage error={action.error} />
            {mode === "register" && (
              <label>
                Your name
                <input
                  required
                  maxLength={80}
                  autoComplete="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="What should we call you?"
                />
              </label>
            )}
            <label>
              Email address
              <input
                required
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                aria-invalid={action.error?.field === "email"}
                aria-describedby={
                  action.error?.field === "email"
                    ? "auth-email-error"
                    : undefined
                }
              />
              {action.error?.field === "email" && (
                <small id="auth-email-error" className="field-error">
                  {action.error.message}
                </small>
              )}
            </label>
            <label>
              Password
              <input
                type="password"
                required
                minLength={mode === "register" ? 8 : undefined}
                maxLength={256}
                autoComplete={
                  mode === "register" ? "new-password" : "current-password"
                }
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={
                  mode === "register"
                    ? "At least 8 characters"
                    : "Your password"
                }
                aria-invalid={action.error?.field === "password"}
                aria-describedby={
                  action.error?.field === "password"
                    ? "auth-password-error"
                    : undefined
                }
              />
              {action.error?.field === "password" && (
                <small id="auth-password-error" className="field-error">
                  {action.error.message}
                </small>
              )}
            </label>
            {mode === "register" && (
              <TimezoneField value={timezone} change={setTimezone} />
            )}
            <Submit pending={action.pending} offline={offline}>
              {mode === "register" ? "Create your account" : "Sign in"}
              <ArrowRight size={18} />
            </Submit>
          </Form>
          <p className="auth-note">
            <LockKeyhole size={14} />
            Your tasks are private until you choose to share them.
          </p>
          {offline && (
            <ErrorMessage error="You’re offline. Reconnect to sign in or create an account." />
          )}
        </div>
      </section>
    </main>
  );
}

export function ProfileSettings({
  user,
  offline,
  close,
  updated,
  loggedOut,
}: {
  user: Profile;
  offline: boolean;
  close: () => void;
  updated: (user: Profile) => void;
  loggedOut: () => void;
}) {
  const [name, setName] = useState(user.name);
  const [timezone, setTimezone] = useState(user.timezone);
  const action = useAction();
  return (
    <Modal title="Your profile" close={close}>
      <Form
        pending={action.pending}
        onSubmit={(event) => {
          event.preventDefault();
          void action.run(
            () => api<{ user: Profile }>("/api/profile", { name, timezone }),
            (data) => {
              updated(data.user);
              close();
            },
          );
        }}
      >
        <ErrorMessage error={action.error} />
        <div className="profile-intro">
          <span className="avatar">{user.name.slice(0, 2).toUpperCase()}</span>
          <div>
            <strong>{user.name}</strong>
            <p className="muted small">{user.email}</p>
          </div>
        </div>
        <label>
          Display name
          <input
            data-autofocus
            required
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <TimezoneField value={timezone} change={setTimezone} />
        <p className="field-note">
          Timezone changes apply to future days. Existing history keeps the
          timezone it was recorded in.
        </p>
        <footer className="form-footer">
          <button className="button secondary" type="button" onClick={close}>
            Cancel
          </button>
          <Submit pending={action.pending} offline={offline} />
        </footer>
        <div className="settings-section">
          <button
            type="button"
            className="button danger-text"
            disabled={action.pending || offline}
            onClick={() => {
              void action.run(() => api("/api/auth/logout", {}), loggedOut);
            }}
          >
            <LogOut size={17} />
            Sign out
          </button>
        </div>
      </Form>
    </Modal>
  );
}

export function InviteDialog({
  token,
  offline,
  close,
  joined,
}: {
  token: string;
  offline: boolean;
  close: () => void;
  joined: (partyId: string) => void;
}) {
  const preview = useResource<InvitePreview>(
    `/api/invites/${encodeURIComponent(token)}`,
  );
  const action = useAction();
  return (
    <Modal title="You’re invited" close={close}>
      <div className="invite-dialog">
        <div className="empty-orbit">
          <Users size={30} />
        </div>
        <ErrorMessage error={preview.error || action.error} />
        {preview.data ? (
          <>
            <span className="eyebrow">A PLACE IN THE CIRCLE</span>
            <h3>{preview.data.partyName}</h3>
            <p className="muted">
              {preview.data.description ||
                "A private space to make progress together."}
            </p>
            <p className="small muted">
              {preview.data.memberCount}{" "}
              {preview.data.memberCount === 1 ? "member" : "members"} · Invite
              expires {new Date(preview.data.expiresAt).toLocaleDateString()}
            </p>
            <div className="privacy-note">
              <LockKeyhole size={16} />
              Joining won’t share your private tasks. You choose what your party
              sees.
            </div>
            <button
              className="button primary"
              disabled={offline || action.pending}
              onClick={() => {
                void action.run(
                  () =>
                    api<{ partyId: string }>(
                      `/api/invites/${encodeURIComponent(token)}/join`,
                      {},
                    ),
                  (data) => joined(data.partyId),
                );
              }}
            >
              {action.pending ? "Joining…" : "Accept invitation"}
              <ArrowRight size={17} />
            </button>
          </>
        ) : (
          !preview.error && <p className="muted">Loading invitation…</p>
        )}
        <button className="text-button" onClick={close}>
          Not now
        </button>
      </div>
    </Modal>
  );
}
