"use client";

import { useEffect, useState } from "react";
import {
  Plus,
  Check,
  Hash,
  Timer,
  MoreHorizontal,
  Play,
  Pause,
  LockKeyhole,
  Users,
  ArrowUp,
  ArrowDown,
  SlidersHorizontal,
  Flame,
  ArrowRight,
  Sprout,
  X,
} from "lucide-react";
import type { Dashboard, TaskView } from "@/shared/types";
import {
  api,
  dateLabel,
  ErrorMessage,
  Form,
  Modal,
  ProgressBar,
  quantity,
  Submit,
  useAction,
} from "./ui";

export function TodayView({
  dashboard,
  offline,
  refresh,
  edit,
  create,
}: {
  dashboard: Dashboard;
  offline: boolean;
  refresh: () => void;
  edit: (task: TaskView) => void;
  create: () => void;
}) {
  const [library, setLibrary] = useState(false);
  const summary = dashboard.summary;
  const upcoming = dashboard.plannedTasks.filter(
    (task) => !task.endDate || task.endDate >= dashboard.date,
  );
  return (
    <section>
      <header className="page-heading">
        <div>
          <span className="eyebrow">
            {dateLabel(dashboard.date, true).toUpperCase()}
          </span>
          <h1>A little better today.</h1>
          <p className="muted">
            Your pace. Your priorities. Let’s make it count.
          </p>
        </div>
        <button className="button primary" disabled={offline} onClick={create}>
          <Plus size={18} />
          New task
        </button>
      </header>
      <div className="daily-overview">
        <div
          className="daily-ring"
          style={
            {
              "--progress": `${(summary.percent || 0) * 3.6}deg`,
            } as React.CSSProperties
          }
        >
          <div>
            <strong>
              {summary.percent === null
                ? "—"
                : `${Math.round(summary.percent)}%`}
            </strong>
            <span>of your day</span>
          </div>
        </div>
        <div className="daily-copy">
          <span className="eyebrow">TODAY’S MOMENTUM</span>
          <h2>
            {summary.percent === null
              ? "Room for a fresh start."
              : summary.completed === summary.total
                ? "You showed up for yourself."
                : summary.percent > 0
                  ? "You’re moving forward."
                  : "Every small step counts."}
          </h2>
          <p>
            {summary.total ? (
              <>
                <strong>
                  {summary.completed} of {summary.total} tasks
                </strong>{" "}
                complete
                {summary.percent !== null &&
                summary.percent > 0 &&
                summary.completed !== summary.total
                  ? " · Your partial progress counts, too."
                  : ". One step at a time."}
              </>
            ) : (
              "No tasks planned for today. Make a little space for what matters."
            )}
          </p>
          <ProgressBar value={summary.percent} label="Today’s completion" />
        </div>
        <Sprout className="overview-sprout" size={58} strokeWidth={1} />
      </div>
      <div className="section-heading task-section-heading">
        <div>
          <h2>
            Your daily plan{" "}
            <span className="count-badge">{dashboard.tasks.length}</span>
          </h2>
          <span className="muted small">
            Small commitments. Real follow-through.
          </span>
        </div>
        <button className="button subtle" onClick={() => setLibrary(true)}>
          <SlidersHorizontal size={16} />
          Manage tasks
        </button>
      </div>
      {dashboard.tasks.length ? (
        <div className="task-list">
          {dashboard.tasks.map((task) => (
            <TaskRow
              key={`${task.id}-${task.date}`}
              task={task}
              running={dashboard.timer?.taskId === task.id}
              offline={offline}
              refresh={refresh}
              edit={() => edit(task)}
            />
          ))}
        </div>
      ) : (
        <div className="empty-state today-empty">
          <div className="empty-orbit">
            <Sprout size={31} />
          </div>
          <h2>
            {upcoming.length
              ? "A little breathing room."
              : "Your first small step."}
          </h2>
          <p>
            {upcoming.length
              ? "Nothing is scheduled today. Enjoy your rest day, or make room for a new task."
              : "Read a few pages. Move your body. Make time to learn. Choose something that matters to you."}
          </p>
          <button
            className="button primary"
            onClick={create}
            disabled={offline}
          >
            <Plus size={18} />
            {upcoming.length ? "Add a task" : "Create your first task"}
          </button>
        </div>
      )}
      <div className="today-footnote">
        <span className="tiny-lime-square" />
        <p>
          Consistency isn’t doing everything. It’s coming back to what matters.
        </p>
      </div>
      {library && (
        <TaskLibrary
          tasks={dashboard.plannedTasks}
          offline={offline}
          refresh={refresh}
          close={() => setLibrary(false)}
          create={() => {
            setLibrary(false);
            create();
          }}
          edit={(task) => {
            setLibrary(false);
            edit(task);
          }}
        />
      )}
    </section>
  );
}

function TaskRow({
  task,
  running,
  offline,
  refresh,
  edit,
}: {
  task: TaskView;
  running: boolean;
  offline: boolean;
  refresh: () => void;
  edit: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [operation, setOperation] = useState<"add" | "set">("add");
  const [amount, setAmount] = useState("");
  const action = useAction(refresh);
  const Icon =
    task.type === "binary" ? Check : task.type === "count" ? Hash : Timer;
  return (
    <article className={`task-row ${task.complete ? "task-complete" : ""}`}>
      <div
        className={`task-type-icon ${task.complete ? "completed-icon" : ""}`}
      >
        <Icon size={21} />
      </div>
      <div className="task-body">
        <div className="task-title-line">
          <h3>{task.title}</h3>
          {!task.archived && (
            <button
              className="icon-button task-menu"
              aria-label={`Edit ${task.title}`}
              onClick={edit}
            >
              <MoreHorizontal size={20} />
            </button>
          )}
        </div>
        {task.description && (
          <p className="task-description">{task.description}</p>
        )}
        <div className="task-meta">
          <span>
            {task.partyId ? <Users size={12} /> : <LockKeyhole size={12} />}
            {task.partyName || "Only you"}
          </span>
          {task.streak > 0 && (
            <span className="streak">
              <Flame size={12} />
              {task.streak} day streak
            </span>
          )}
          {task.hasPendingChanges && <span>Changes tomorrow</span>}
          {task.archived && <span>Archived · final day</span>}
        </div>
        {task.type !== "binary" && (
          <div className="task-progress">
            <ProgressBar
              value={task.percent}
              label={`${task.title} completion`}
            />
            <span>
              <strong>{quantity(task.value, task.type, task.unit)}</strong>{" "}
              <span className="muted">
                / {quantity(task.target, task.type, task.unit)}
              </span>
            </span>
          </div>
        )}
        <ErrorMessage error={action.error} />
        {expanded && (
          <Form
            className="inline-log"
            pending={action.pending}
            onSubmit={(event) => {
              event.preventDefault();
              void action.run(() =>
                api("/api/progress/log", {
                  taskId: task.id,
                  date: task.date,
                  operation,
                  value: Number(amount) * (task.type === "duration" ? 60 : 1),
                }),
              );
            }}
          >
            <label>
              Action
              <select
                value={operation}
                onChange={(event) =>
                  setOperation(event.target.value as "add" | "set")
                }
              >
                <option value="add">Add progress</option>
                <option value="set">Correct total</option>
              </select>
            </label>
            <label>
              {task.type === "duration" ? "Minutes" : task.unit || "Amount"}
              <input
                type="number"
                min="0"
                step={task.type === "duration" ? "any" : "1"}
                required
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0"
              />
            </label>
            <Submit pending={action.pending} offline={offline}>
              {operation === "set" ? "Set total" : "Add"}
            </Submit>
            <button
              className="icon-button"
              type="button"
              aria-label="Close manual entry"
              onClick={() => setExpanded(false)}
            >
              <X size={16} />
            </button>
            <p className="field-note">
              {operation === "set"
                ? `Current total: ${quantity(task.value, task.type, task.unit)}. This replaces the total for this day.`
                : "Adds to your saved total. Use Correct total to undo an entry."}
            </p>
          </Form>
        )}
      </div>
      <div className="task-actions">
        {task.type === "binary" ? (
          <button
            className={`button ${task.complete ? "done-button" : "secondary"}`}
            aria-pressed={task.complete}
            disabled={offline || action.pending}
            onClick={() => {
              void action.run(() =>
                api("/api/progress/log", {
                  taskId: task.id,
                  date: task.date,
                  operation: "set",
                  value: task.complete ? 0 : 1,
                }),
              );
            }}
          >
            <Check size={17} />
            {task.complete ? "Done · undo" : "Mark done"}
          </button>
        ) : task.type === "count" ? (
          <>
            <button
              className="button secondary"
              aria-label={`Add 1 ${task.unit || "unit"}`}
              disabled={offline || action.pending}
              onClick={() => {
                void action.run(() =>
                  api("/api/progress/log", {
                    taskId: task.id,
                    date: task.date,
                    operation: "add",
                    value: 1,
                  }),
                );
              }}
            >
              <Plus size={16} />1
            </button>
            <button
              className="button subtle"
              onClick={() => setExpanded(!expanded)}
              aria-expanded={expanded}
            >
              Log progress
            </button>
          </>
        ) : (
          <>
            <button
              className={`button ${running ? "timer-active" : "secondary"}`}
              disabled={offline || action.pending}
              onClick={() => {
                void action.run(() =>
                  api("/api/timer", {
                    taskId: task.id,
                    action: running ? "pause" : "start",
                  }),
                );
              }}
            >
              {running ? <Pause size={16} /> : <Play size={16} />}
              {running ? "Pause" : task.value > 0 ? "Resume" : "Start timer"}
            </button>
            <button
              className="button subtle"
              onClick={() => setExpanded(!expanded)}
              aria-expanded={expanded}
            >
              Manual entry
            </button>
          </>
        )}
      </div>
    </article>
  );
}

function TaskLibrary({
  tasks,
  offline,
  refresh,
  close,
  edit,
  create,
}: {
  tasks: TaskView[];
  offline: boolean;
  refresh: () => void;
  close: () => void;
  edit: (task: TaskView) => void;
  create: () => void;
}) {
  const action = useAction(refresh);
  function reorder(index: number, direction: number) {
    const ids = tasks.map((task) => task.id);
    const next = index + direction;
    [ids[index], ids[next]] = [ids[next], ids[index]];
    void action.run(() => api("/api/tasks/reorder", { ids }));
  }
  return (
    <Modal title="Your task library" close={close}>
      <div className="settings-body">
        <p className="muted">
          All your active tasks, including future plans, rest-day routines, and
          tasks archived today. Move tasks to set the order of your day.
        </p>
        <ErrorMessage error={action.error} />
        {tasks.length ? (
          <div className="library-list">
            {tasks.map((task, index) => (
              <div key={task.id}>
                <div className="library-task">
                  <strong>{task.title}</strong>
                  <small>
                    {task.schedule.kind === "daily"
                      ? "Every day"
                      : task.schedule.kind === "once"
                        ? `One time · ${task.startDate}`
                        : task.schedule.days
                            .map(
                              (day) =>
                                [
                                  "",
                                  "Mon",
                                  "Tue",
                                  "Wed",
                                  "Thu",
                                  "Fri",
                                  "Sat",
                                  "Sun",
                                ][day],
                            )
                            .join(", ")}{" "}
                    · From {task.startDate}
                    {task.endDate && task.endDate < task.date
                      ? ` · Ended ${task.endDate}`
                      : ""}
                    {task.archived && " · Archived"}
                    {task.hasPendingChanges && " · Changes tomorrow"}
                  </small>
                </div>
                <div className="library-actions">
                  <button
                    className="icon-button"
                    aria-label={`Move ${task.title} up`}
                    disabled={
                      index === 0 || offline || action.pending || task.archived
                    }
                    onClick={() => reorder(index, -1)}
                  >
                    <ArrowUp size={16} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Move ${task.title} down`}
                    disabled={
                      index === tasks.length - 1 ||
                      offline ||
                      action.pending ||
                      task.archived
                    }
                    onClick={() => reorder(index, 1)}
                  >
                    <ArrowDown size={16} />
                  </button>
                  {task.archived ? (
                    <span className="small muted">Archived</span>
                  ) : (
                    <button
                      className="button subtle"
                      onClick={() => edit(task)}
                    >
                      Edit
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="quiet-empty">
            No tasks yet. Your next small step starts here.
          </p>
        )}
        <button className="button primary" disabled={offline} onClick={create}>
          <Plus size={17} />
          New task
        </button>
      </div>
    </Modal>
  );
}

export function RunningTimer({
  dashboard,
  offline,
  refresh,
  goToday,
}: {
  dashboard: Dashboard;
  offline: boolean;
  refresh: () => void;
  goToday: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  const action = useAction(refresh);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const timer = dashboard.timer;
  if (!timer) return null;
  const task = dashboard.tasks.find((item) => item.id === timer.taskId);
  const elapsed = Math.max(
    0,
    Math.floor((now - new Date(timer.accountedAt).getTime()) / 1000),
  );
  return (
    <div className="running-timer">
      <span className="timer-pulse">
        <Timer size={20} />
      </span>
      <button className="timer-title" onClick={goToday}>
        <span>FOCUS IN PROGRESS</span>
        <strong>{timer.title}</strong>
      </button>
      <span
        className="timer-time"
        aria-label="Time logged including the active session"
      >
        {quantity((task?.value || 0) + elapsed, "duration", "seconds")}
      </span>
      <button
        className="button secondary"
        disabled={offline || action.pending}
        onClick={() => {
          void action.run(() =>
            api("/api/timer", { taskId: timer.taskId, action: "pause" }),
          );
        }}
      >
        <Pause size={16} />
        Pause / finish
      </button>
      <ErrorMessage error={action.error} />
    </div>
  );
}
