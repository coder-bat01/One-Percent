"use client";

import { useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Flame,
  List,
  Grid2X2,
  ArrowUpRight,
} from "lucide-react";
import type { DaySummary, ProgressData } from "@/shared/types";
import {
  dateLabel,
  ErrorMessage,
  Loading,
  quantity,
  shiftDate,
  TaskReadOnly,
  useResource,
} from "./ui";

function dayDescription(day: DaySummary, today: string) {
  if (day.percent === null) return "No tasks planned";
  if (day.date > today) return `${day.total} tasks planned`;
  return `${Math.round(day.percent)}% · ${day.completed}/${day.total} complete`;
}

export function ProgressView({
  endpoint = "/api/progress",
  version,
  initialDate,
  range,
  anchor,
  taskId = "",
  navigate,
  member = false,
}: {
  endpoint?: string;
  version: number;
  initialDate: string;
  range: "week" | "month";
  anchor: string;
  taskId?: string;
  navigate: (params: Record<string, string>) => void;
  member?: boolean;
}) {
  const [list, setList] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const resource = useResource<ProgressData>(
    `${endpoint}?range=${range}&anchor=${encodeURIComponent(anchor || initialDate)}${taskId ? `&taskId=${encodeURIComponent(taskId)}` : ""}`,
    version,
  );
  const data = resource.data;
  useEffect(() => {
    if (taskId) setHistoryOpen(true);
  }, [taskId]);
  function move(direction: number) {
    const value = anchor || initialDate;
    if (range === "week") navigate({ anchor: shiftDate(value, 7 * direction) });
    else {
      const date = new Date(`${value}T12:00:00Z`);
      date.setUTCDate(1);
      date.setUTCMonth(date.getUTCMonth() + direction);
      navigate({ anchor: date.toISOString().slice(0, 10) });
    }
  }
  return (
    <section
      className="progress-view"
      aria-label={member ? "Shared progress history" : "Your progress history"}
    >
      {!member && (
        <header className="page-heading">
          <div>
            <span className="eyebrow">THE BIGGER PICTURE</span>
            <h1>Small steps. Real progress.</h1>
            <p className="muted">A record of showing up, one day at a time.</p>
          </div>
          <CalendarDays className="heading-icon" size={30} />
        </header>
      )}
      <div className="progress-toolbar">
        <div className="segmented" aria-label="Time range">
          <button
            aria-pressed={range === "week"}
            onClick={() => navigate({ range: "week" })}
          >
            Week
          </button>
          <button
            aria-pressed={range === "month"}
            onClick={() => navigate({ range: "month" })}
          >
            Month
          </button>
        </div>
        <div className="date-control">
          <button
            className="icon-button"
            aria-label={`Previous ${range}`}
            onClick={() => move(-1)}
          >
            <ChevronLeft size={19} />
          </button>
          <label
            className="sr-only"
            htmlFor={member ? "member-anchor" : "progress-anchor"}
          >
            Period containing date
          </label>
          <input
            id={member ? "member-anchor" : "progress-anchor"}
            type="date"
            value={anchor || initialDate}
            onChange={(event) => {
              if (event.target.value) navigate({ anchor: event.target.value });
            }}
          />
          <button
            className="icon-button"
            aria-label={`Next ${range}`}
            onClick={() => move(1)}
          >
            <ChevronRight size={19} />
          </button>
        </div>
        <button
          className="text-button"
          onClick={() => navigate({ anchor: initialDate })}
        >
          This {range}
        </button>
      </div>
      <ErrorMessage error={resource.error} />
      {resource.loading && !data && <Loading text="Gathering your progress…" />}
      {data && (
        <>
          <div className="section-heading">
            <div>
              <h2>
                {dateLabel(data.startDate)} — {dateLabel(data.endDate)}
              </h2>
              <p className="muted small">
                Each day reflects its original plan. Rest days aren’t counted as
                missed days.
              </p>
            </div>
            <button
              className="button subtle"
              aria-pressed={list}
              onClick={() => setList(!list)}
            >
              {list ? <Grid2X2 size={17} /> : <List size={17} />}
              {list ? "Calendar" : "Text list"}
            </button>
          </div>
          {list ? (
            <div className="day-list">
              {data.days.map((day) => (
                <div key={day.date}>
                  <time dateTime={day.date}>{dateLabel(day.date, true)}</time>
                  <strong>{dayDescription(day, data.today)}</strong>
                </div>
              ))}
            </div>
          ) : (
            <div
              className={`heatmap ${range === "month" ? "month" : "week"}`}
              role="list"
              aria-label="Daily completion calendar"
            >
              {data.days.map((day) => {
                const future = day.date > data.today;
                return (
                  <div
                    key={day.date}
                    role="listitem"
                    className={`heat-day ${day.date === data.today ? "is-today" : ""} ${day.percent === null ? "rest-day" : ""} ${future ? "future-day" : ""}`}
                    style={
                      {
                        "--completion": `${Math.min(100, day.percent || 0)}%`,
                      } as React.CSSProperties
                    }
                    aria-label={`${dateLabel(day.date, true)}: ${dayDescription(day, data.today)}`}
                  >
                    <time dateTime={day.date}>
                      <span>
                        {new Date(`${day.date}T12:00:00`).toLocaleDateString(
                          undefined,
                          { weekday: "short" },
                        )}
                      </span>
                      {Number(day.date.slice(-2))}
                    </time>
                    <strong>
                      {day.percent === null
                        ? "—"
                        : future
                          ? "Plan"
                          : `${Math.round(day.percent)}%`}
                    </strong>
                    <span className="day-completion">
                      {!day.total
                        ? "Rest"
                        : future
                          ? `${day.total} due`
                          : `${day.completed}/${day.total}`}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          <div className="heatmap-key">
            <span>
              No plan <i className="key-rest" />
            </span>
            <span>
              0% <i className="key-empty" />
            </span>
            <span>
              100% <i className="key-full" />
            </span>
          </div>
          <section className="unit-totals">
            <h3>Work that adds up</h3>
            {data.totals.length ? (
              <div className="totals-grid">
                {data.totals.map((total, index) => (
                  <div key={`${total.unit}-${index}`}>
                    <ArrowUpRight size={20} />
                    <strong>
                      {total.unit === "seconds"
                        ? quantity(total.value, "duration", "seconds")
                        : Number(total.value.toFixed(2)).toLocaleString()}
                    </strong>
                    <span>
                      {total.unit === "seconds"
                        ? "time logged"
                        : total.unit || "completed tasks"}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">
                Your totals will appear as you log progress. Different units
                stay separate.
              </p>
            )}
          </section>
          <div className="section-heading">
            <h2>Task by task</h2>
            {taskId && !member && (
              <button
                className="text-button"
                onClick={() => navigate({ task: "" })}
              >
                Show all tasks
              </button>
            )}
          </div>
          {data.tasks.length ? (
            <div className="task-statistics">
              {data.tasks.map((task) => (
                <div
                  className="task-stat"
                  key={`${task.id}-${task.type}-${task.unit}`}
                >
                  <div>
                    <strong>{task.title}</strong>
                    <span className="small muted">
                      {task.type === "binary"
                        ? `${task.total} completions`
                        : quantity(task.total, task.type, task.unit)}{" "}
                      in this period
                    </span>
                  </div>
                  <span className="streak">
                    <Flame size={16} />
                    {task.streak} scheduled-day streak
                  </span>
                  {!member && (
                    <button
                      className="button subtle"
                      aria-pressed={taskId === task.id}
                      onClick={() =>
                        navigate({ task: taskId === task.id ? "" : task.id })
                      }
                    >
                      {taskId === task.id ? "All history" : "View history"}
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state compact">
              <CalendarDays size={28} />
              <h3>No tasks in this period</h3>
              <p>Choose another date to explore your history.</p>
            </div>
          )}
          <details
            className="history-details"
            open={historyOpen}
            onToggle={(event) => setHistoryOpen(event.currentTarget.open)}
          >
            <summary>
              Daily task history <span>{data.history.length} records</span>
            </summary>
            {data.history.length ? (
              <div>
                {data.history.map((task) => (
                  <div className="history-row" key={`${task.id}-${task.date}`}>
                    <time dateTime={task.date}>{dateLabel(task.date)}</time>
                    <TaskReadOnly task={task} />
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">No task history for this period.</p>
            )}
          </details>
        </>
      )}
    </section>
  );
}
