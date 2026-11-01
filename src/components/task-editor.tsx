"use client";

import { useState } from "react";
import { Check, Hash, Timer, LockKeyhole, Users, Archive } from "lucide-react";
import type {
  PartySummary,
  TaskInput,
  TaskType,
  TaskView,
} from "@/shared/types";
import { api, ErrorMessage, Form, Modal, shiftDate, Submit, useAction } from "./ui";

export function TaskEditor({
  task,
  date,
  parties,
  offline,
  timerTaskId,
  close,
  refresh,
}: {
  task?: TaskView;
  date: string;
  parties: PartySummary[];
  offline: boolean;
  timerTaskId?: string;
  close: () => void;
  refresh: () => void;
}) {
  const [title, setTitle] = useState(task?.title || "");
  const [description, setDescription] = useState(task?.description || "");
  const [type, setType] = useState<TaskType>(task?.type || "binary");
  const [target, setTarget] = useState(
    String(
      task
        ? task.type === "duration"
          ? Math.floor(task.target / 60)
          : task.target
        : 1,
    ),
  );
  const [seconds, setSeconds] = useState(
    String(task?.type === "duration" ? task.target % 60 : 0),
  );
  const [unit, setUnit] = useState(task?.unit || "reps");
  const [schedule, setSchedule] = useState(task?.schedule.kind || "daily");
  const [days, setDays] = useState<number[]>(
    task?.schedule.days || [1, 2, 3, 4, 5],
  );
  const [startDate, setStartDate] = useState(task?.startDate || date);
  const [endDate, setEndDate] = useState(task?.endDate || "");
  const [partyId, setPartyId] = useState(task?.partyId || "");
  const [effective, setEffective] = useState<"today" | "tomorrow">(
    task?.hasPendingChanges ? "tomorrow" : "today",
  );
  const [archive, setArchive] = useState(false);
  const action = useAction(refresh);
  const minDate = shiftDate(date, -3660);
  const maxDate = shiftDate(date, 3660);
  const forcedTomorrow =
    !!task &&
    task.type !== type &&
    (task.value > 0 || timerTaskId === task.id);
  const fieldError = (field: string) =>
    action.error?.field === field ? action.error.message : undefined;
  return (
    <Modal
      title={task ? "Edit your task" : "Make a little progress"}
      close={close}
    >
      <Form
        pending={action.pending}
        onSubmit={(event) => {
          event.preventDefault();
          const input: TaskInput = {
            ...(task ? { id: task.id, revision: task.revision } : {}),
            title,
            description,
            type,
            target:
              type === "binary"
                ? 1
                : type === "duration"
                  ? Number(target) * 60 + Number(seconds)
                  : Number(target),
            unit:
              type === "duration" ? "seconds" : type === "binary" ? "" : unit,
            schedule: {
              kind: schedule,
              days: schedule === "weekdays" ? days : [],
            },
            startDate,
            endDate: schedule === "once" ? startDate : endDate || null,
            partyId: partyId || null,
            effective: forcedTomorrow ? "tomorrow" : effective,
          };
          void action.run(() => api("/api/tasks/save", input), close);
        }}
      >
        <p className="muted">
          Small enough to start. Meaningful enough to keep.
        </p>
        <ErrorMessage error={action.error} />
        <label>
          Task name
          <input
            data-autofocus
            required
            maxLength={120}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="What will you work on?"
            aria-invalid={!!fieldError("title")}
            aria-describedby={
              fieldError("title") ? "task-title-error" : undefined
            }
          />
          {fieldError("title") && (
            <small id="task-title-error" className="field-error">
              {fieldError("title")}
            </small>
          )}
        </label>
        <label>
          Description <span className="optional">optional</span>
          <textarea
            rows={2}
            maxLength={2000}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="A reminder of why this matters to you"
          />
        </label>
        <fieldset>
          <legend>How will you track it?</legend>
          <div className="type-picker">
            {(
              [
                { id: "binary", title: "Yes / no", icon: Check },
                { id: "count", title: "Count", icon: Hash },
                { id: "duration", title: "Duration", icon: Timer },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={type === item.id}
                className={type === item.id ? "selected" : ""}
                onClick={() => {
                  setType(item.id);
                  if (item.id === "duration" && type !== "duration")
                    setTarget("30");
                  else if (item.id === "count" && type !== "count") {
                    setTarget("10");
                    if (!unit || unit === "seconds") setUnit("reps");
                  }
                }}
              >
                <item.icon size={20} />
                {item.title}
              </button>
            ))}
          </div>
        </fieldset>
        {type !== "binary" && (
          <div className="form-grid">
            <label>
              {type === "duration" ? "Target · minutes" : "Daily target"}
              <input
                name="target"
                type="number"
                min={type === "duration" ? 0 : 1}
                step="1"
                required
                value={target}
                onChange={(event) => setTarget(event.target.value)}
                aria-invalid={!!fieldError("target")}
                aria-describedby={
                  fieldError("target") ? "task-target-error" : undefined
                }
              />
              {fieldError("target") && (
                <small id="task-target-error" className="field-error">
                  {fieldError("target")}
                </small>
              )}
            </label>
            {type === "count" ? (
              <label>
                Unit
                <input
                  name="unit"
                  required
                  maxLength={40}
                  value={unit}
                  onChange={(event) => setUnit(event.target.value)}
                  placeholder="pages, reps, glasses…"
                  aria-invalid={!!fieldError("unit")}
                />
                {fieldError("unit") && (
                  <small className="field-error">{fieldError("unit")}</small>
                )}
              </label>
            ) : (
              <label>
                Additional seconds
                <input
                  name="seconds"
                  type="number"
                  min="0"
                  max="59"
                  step="1"
                  required
                  value={seconds}
                  onChange={(event) => setSeconds(event.target.value)}
                />
              </label>
            )}
          </div>
        )}
        <label>
          Repeat
          <select
            value={schedule}
            onChange={(event) =>
              setSchedule(event.target.value as typeof schedule)
            }
          >
            <option value="daily">Every day</option>
            <option value="weekdays">Selected weekdays</option>
            <option value="once">One date only</option>
          </select>
        </label>
        {schedule === "weekdays" && (
          <fieldset>
            <legend>On these days</legend>
            <div className="weekday-picker">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(
                (day, index) => (
                  <label key={day}>
                    <input
                      type="checkbox"
                      checked={days.includes(index + 1)}
                      onChange={(event) =>
                        setDays((current) =>
                          event.target.checked
                            ? [...current, index + 1].sort()
                            : current.filter((value) => value !== index + 1),
                        )
                      }
                    />
                    <span>{day}</span>
                  </label>
                ),
              )}
            </div>
            {fieldError("schedule") && (
              <small className="field-error">{fieldError("schedule")}</small>
            )}
          </fieldset>
        )}
        <div className="form-grid">
          <label>
            {schedule === "once" ? "Date" : "Start date"}
            <input
              name="startDate"
              type="date"
              required
              min={minDate}
              max={maxDate}
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              aria-invalid={!!fieldError("startDate")}
            />
            {fieldError("startDate") && (
              <small className="field-error">{fieldError("startDate")}</small>
            )}
          </label>
          {schedule !== "once" && (
            <label>
              End date <span className="optional">optional</span>
              <input
                name="endDate"
                type="date"
                min={startDate}
                max={maxDate}
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                aria-invalid={!!fieldError("endDate")}
              />
              {fieldError("endDate") && (
                <small className="field-error">{fieldError("endDate")}</small>
              )}
            </label>
          )}
        </div>
        <label>
          <span className="inline">
            <LockKeyhole size={15} /> Visibility
          </span>
          <select
            name="partyId"
            value={partyId}
            onChange={(event) => setPartyId(event.target.value)}
            aria-invalid={!!fieldError("partyId")}
          >
            <option value="">Only me · private</option>
            {parties.map((party) => (
              <option key={party.id} value={party.id}>
                Share with {party.name}
              </option>
            ))}
          </select>
          {fieldError("partyId") && (
            <small className="field-error">{fieldError("partyId")}</small>
          )}
        </label>
        <p className="field-note">
          <Users size={15} /> Only the party you choose can see shared days.
          Earlier private days stay private; days you already shared stay
          visible to that party.
        </p>
        {task && (
          <label>
            Apply changes
            <select
              value={forcedTomorrow ? "tomorrow" : effective}
              disabled={forcedTomorrow}
              onChange={(event) =>
                setEffective(event.target.value as "today" | "tomorrow")
              }
            >
              <option value="today">From today</option>
              <option value="tomorrow">From tomorrow</option>
            </select>
            <small>
              {forcedTomorrow
                ? "You’ve already logged progress. A tracking-type change starts tomorrow."
                : "Past days keep their original goals and measurements."}
            </small>
          </label>
        )}
        <footer className="form-footer">
          {task && (
            <button
              className="button danger-text"
              type="button"
              onClick={() => setArchive(!archive)}
            >
              <Archive size={17} />
              Archive
            </button>
          )}
          <button className="button secondary" type="button" onClick={close}>
            Cancel
          </button>
          <Submit pending={action.pending} offline={offline}>
            {task ? "Save task" : "Create task"}
          </Submit>
        </footer>
        {archive && (
          <div className="confirm-box">
            <strong>Archive this task?</strong>
            <p>
              It stops appearing from tomorrow. Today and all your history are
              kept.
            </p>
            <button
              type="button"
              className="button danger"
              disabled={offline || action.pending}
              onClick={() => {
                void action.run(
                  () => api("/api/tasks/archive", { id: task!.id }),
                  close,
                );
              }}
            >
              Confirm archive
            </button>
          </div>
        )}
      </Form>
    </Modal>
  );
}
