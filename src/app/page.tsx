"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CalendarCheck2,
  ChartNoAxesCombined,
  Check,
  ChevronRight,
  ArrowUpRight,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";
import type { Dashboard, Profile, TaskView } from "@/shared/types";
import {
  api,
  ErrorMessage,
  Loading,
  localDate,
  useResource,
} from "@/components/ui";
import {
  AuthScreen,
  InviteDialog,
  ProfileSettings,
} from "@/components/account";
import { TaskEditor } from "@/components/task-editor";
import { TodayView, RunningTimer } from "@/components/today-view";
import { PartyView } from "@/components/party-view";
import { ProgressView } from "@/components/progress-view";

const destinations = [
  { id: "today", label: "Today", icon: CalendarCheck2 },
  { id: "party", label: "Party", icon: Users },
  { id: "progress", label: "Progress", icon: ChartNoAxesCombined },
] as const;
export default function Home() {
  const [user, setUser] = useState<Profile | null>(null);
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState("");
  const [bootVersion, setBootVersion] = useState(0);
  const [online, setOnline] = useState(true);
  const [connection, setConnection] = useState<
    "connecting" | "live" | "reconnecting"
  >("connecting");
  const [version, setVersion] = useState(0);
  const [params, setParams] = useState("");
  const [profile, setProfile] = useState(false);
  const [editor, setEditor] = useState<TaskView | "new" | null>(null);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(0);
  const [lastSave, setLastSave] = useState<"none" | "saved" | "failed">("none");
  const mainRef = useRef<HTMLElement>(null);
  const refresh = useCallback(() => setVersion((value) => value + 1), []);
  const query = new URLSearchParams(params);
  const rawView = query.get("view");
  const view =
    rawView === "party" || rawView === "progress" ? rawView : "today";
  const invite = query.get("invite") || "";
  const navigate = useCallback((values: Record<string, string>) => {
    const url = new URL(window.location.href);
    for (const [key, value] of Object.entries(values)) {
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    }
    window.history.pushState(
      null,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
    setParams(url.search);
  }, []);
  useEffect(() => {
    setParams(window.location.search);
    const back = () => setParams(window.location.search);
    const on = () => {
      setOnline(true);
      refresh();
    };
    const off = () => {
      setOnline(false);
      setConnection("reconnecting");
    };
    setOnline(navigator.onLine);
    const expired = () => {
      setUser(null);
      setProfile(false);
      setEditor(null);
      setNotice("");
    };
    const started = () => {
      setSaving((value) => value + 1);
      setLastSave("none");
    };
    const ended = (event: Event) => {
      setSaving((value) => Math.max(0, value - 1));
      setLastSave(
        (event as CustomEvent<{ success: boolean }>).detail.success
          ? "saved"
          : "failed",
      );
    };
    window.addEventListener("session-expired", expired);
    window.addEventListener("mutation-start", started);
    window.addEventListener("mutation-end", ended);
    window.addEventListener("popstate", back);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("popstate", back);
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      window.removeEventListener("session-expired", expired);
      window.removeEventListener("mutation-start", started);
      window.removeEventListener("mutation-end", ended);
    };
  }, [refresh]);
  useEffect(() => {
    const controller = new AbortController();
    setBooting(true);
    setBootError("");
    api<{ user: Profile | null }>("/api/session", undefined, controller.signal)
      .then((data) => {
        setUser(data.user);
        setBooting(false);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setBootError(error.message);
          setBooting(false);
        }
      });
    return () => controller.abort();
  }, [bootVersion]);
  useEffect(() => {
    if (!user || !online) return;
    setConnection("connecting");
    const events = new EventSource("/api/events");
    const update = () => refresh();
    events.addEventListener("open", () => {
      setConnection("live");
      refresh();
    });
    events.addEventListener("refresh", update);
    events.addEventListener("error", () => setConnection("reconnecting"));
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 60_000);
    const visible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      events.close();
      clearInterval(interval);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [user?.id, online, refresh]);
  useEffect(() => {
    if (!user || !online || view !== "party") return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 15_000);
    return () => clearInterval(interval);
  }, [user?.id, online, view, refresh]);
  useEffect(() => {
    document.title = `${destinations.find((item) => item.id === view)?.label || "Today"} · 1%`;
    if (user) mainRef.current?.focus();
  }, [view, user?.id]);
  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timeout);
  }, [notice]);
  const dashboard = useResource<Dashboard>(
    user ? "/api/dashboard" : null,
    version,
  );
  const data = dashboard.data;
  const today = data?.date || (user ? localDate(user.timezone) : "");
  useEffect(() => {
    if (
      user &&
      data &&
      (user.timezone !== data.user.timezone || user.name !== data.user.name)
    )
      setUser(data.user);
  }, [data]);
  const activeUser = user || data?.user;
  const parties = data?.parties || [];
  const requestedParty = query.get("party") || "";
  const selectedParty = parties.some((party) => party.id === requestedParty)
    ? requestedParty
    : parties[0]?.id || "";
  const offline = !online;
  if (booting)
    return (
      <div className="boot-screen">
        <div className="wordmark">
          1<span>%</span>
          <span className="brand-period">.</span>
        </div>
        <Loading />
      </div>
    );
  if (bootError)
    return (
      <div className="boot-screen">
        <div className="wordmark">
          1<span>%</span>
          <span className="brand-period">.</span>
        </div>
        <ErrorMessage error={bootError} />
        <button
          className="button primary"
          onClick={() => setBootVersion((value) => value + 1)}
        >
          <RefreshCw size={17} />
          Try again
        </button>
      </div>
    );
  if (!user || !activeUser)
    return (
      <AuthScreen
        offline={offline}
        inviteToken={invite}
        authenticated={(profile) => {
          setUser(profile);
          refresh();
          setNotice("You’re in. Let’s take a small step.");
        }}
      />
    );
  return (
    <div className={`app-shell ${data?.timer ? "has-timer" : ""}`}>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="sidebar">
        <a
          className="wordmark"
          href="/?view=today"
          aria-label="1 percent today"
          onClick={(event) => {
            event.preventDefault();
            navigate({ view: "today" });
          }}
        >
          1<span>%</span>
          <span className="brand-period">.</span>
        </a>
        <p className="brand-tagline">A little better, every day.</p>
        <span className="sidebar-label">YOUR SPACE</span>
        <nav aria-label="Main navigation">
          {destinations.map((item) => (
            <a
              key={item.id}
              href={`/?view=${item.id}`}
              className={view === item.id ? "nav-item active" : "nav-item"}
              aria-current={view === item.id ? "page" : undefined}
              onClick={(event) => {
                event.preventDefault();
                navigate({ view: item.id });
              }}
            >
              <item.icon size={21} />
              <span>{item.label}</span>
              {view === item.id && <span className="nav-active-dot" />}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-philosophy">
            <ArrowUpRight size={27} />
            <p>
              Progress isn’t a race.
              <br />
              <strong>It’s a practice.</strong>
            </p>
          </div>
          <div
            className={`connection-state ${online && connection === "live" ? "is-live" : ""}`}
            role="status"
          >
            {online ? <Wifi size={14} /> : <WifiOff size={14} />}
            <span>
              {!online
                ? "Offline · saves paused"
                : connection === "live"
                  ? "Connected · live sync"
                  : connection === "connecting"
                    ? "Connecting…"
                    : "Reconnecting…"}
            </span>
          </div>
          <button className="profile-button" onClick={() => setProfile(true)}>
            <span className="avatar">
              {activeUser.name.slice(0, 2).toUpperCase()}
            </span>
            <span>
              <strong>{activeUser.name}</strong>
              <small>Your profile</small>
            </span>
            <Settings2 size={17} />
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Your space</span>
            <ChevronRight size={14} />
            <strong>
              {destinations.find((item) => item.id === view)?.label}
            </strong>
          </div>
          <div className="topbar-right">
            <span
              className={`save-state ${lastSave === "failed" ? "save-failed" : ""}`}
              role="status"
            >
              {saving > 0
                ? "Saving…"
                : lastSave === "saved"
                  ? "Saved"
                  : lastSave === "failed"
                    ? "Not saved"
                    : ""}
            </span>
            <span
              className={`global-connection ${online && connection === "live" ? "is-live" : ""}`}
              role="status"
            >
              <span className="connection-dot" />
              {!online
                ? "Offline"
                : connection === "live"
                  ? "Live"
                  : connection === "connecting"
                    ? "Connecting"
                    : "Reconnecting"}
            </span>
            <span className="topbar-timezone">
              {activeUser.timezone.replaceAll("_", " ")}
            </span>
            <button
              className="icon-button"
              title="Refresh saved data"
              aria-label="Refresh saved data"
              onClick={refresh}
            >
              <RefreshCw
                size={16}
                className={dashboard.loading ? "spin" : ""}
              />
            </button>
            <button
              className="mobile-profile avatar"
              aria-label="Open your profile"
              onClick={() => setProfile(true)}
            >
              {activeUser.name.slice(0, 2).toUpperCase()}
            </button>
          </div>
        </header>
        <main
          id="main-content"
          ref={mainRef}
          tabIndex={-1}
          className="main-content"
        >
          {offline && (
            <div className="offline-banner" role="status">
              <WifiOff size={18} />
              <div>
                <strong>You’re offline. Your input stays here.</strong>
                <p>
                  Reconnect to save. Nothing you enter will be marked as saved
                  while offline.
                </p>
              </div>
            </div>
          )}
          {online && connection === "reconnecting" && (
            <div className="reconnecting-banner" role="status">
              <RefreshCw size={15} />
              Live updates are reconnecting. You can still save while the server
              is reachable.
            </div>
          )}
          <ErrorMessage error={dashboard.error} />
          {dashboard.error && (
            <button className="button secondary" onClick={refresh}>
              Try loading again
            </button>
          )}
          {!data && dashboard.loading && view !== "progress" && <Loading />}
          {data && view === "today" && (
            <TodayView
              dashboard={data}
              offline={offline}
              refresh={refresh}
              create={() => setEditor("new")}
              edit={(task) =>
                setEditor(
                  data.plannedTasks.find((planned) => planned.id === task.id) ??
                    task,
                )
              }
            />
          )}
          {view === "party" && data && (
            <PartyView
              parties={parties}
              user={activeUser}
              selected={selectedParty}
              memberId={query.get("member") || ""}
              version={version}
              today={today}
              offline={offline}
              refresh={refresh}
              navigate={navigate}
            />
          )}
          {view === "progress" && (
            <ProgressView
              version={version}
              initialDate={today}
              range={query.get("range") === "month" ? "month" : "week"}
              anchor={query.get("anchor") || today}
              taskId={query.get("task") || ""}
              navigate={navigate}
            />
          )}
          <footer className="workspace-footer">
            <span className="footer-brand">1%</span>
            <span>Small steps. Yours to take.</span>
            <span>
              <ShieldCheck size={13} />
              Private by design
            </span>
          </footer>
        </main>
      </div>
      {data?.timer && (
        <RunningTimer
          dashboard={data}
          offline={offline}
          refresh={refresh}
          goToday={() => navigate({ view: "today" })}
        />
      )}
      {editor && data && (
        <TaskEditor
          task={editor === "new" ? undefined : editor}
          date={today}
          parties={parties}
          offline={offline}
          timerTaskId={data.timer?.taskId}
          close={() => setEditor(null)}
          refresh={() => {
            refresh();
            setNotice("Task saved.");
          }}
        />
      )}
      {profile && (
        <ProfileSettings
          user={activeUser}
          offline={offline}
          close={() => setProfile(false)}
          updated={(profile) => {
            setUser(profile);
            refresh();
            setNotice("Profile saved. Timezone changes take effect tomorrow.");
          }}
          loggedOut={() => {
            setUser(null);
            setProfile(false);
            setEditor(null);
            setNotice("");
          }}
        />
      )}
      {invite && (
        <InviteDialog
          token={invite}
          offline={offline}
          close={() => navigate({ invite: "" })}
          joined={(partyId) => {
            navigate({ invite: "", view: "party", party: partyId });
            refresh();
            setNotice("You joined the party. Welcome to the circle.");
          }}
        />
      )}
      {notice && (
        <div className="save-toast" role="status">
          <Check size={17} />
          {notice}
        </div>
      )}
    </div>
  );
}
