import {
  randomBytes,
  randomUUID,
  createHash,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import { all, one, run, transaction } from "./db";
import {
  addDays,
  dateAt,
  dateRange,
  midnight,
  now,
  period,
  weekday,
} from "./time";
import type {
  Credentials,
  Dashboard,
  DaySummary,
  InvitePreview,
  MembershipInput,
  PartyDetail,
  PartyMember,
  PartySummary,
  Profile,
  ProgressData,
  ProgressInput,
  Registration,
  TaskInput,
  TaskView,
  TimerInput,
  TimerState,
} from "../shared/types";

export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public field?: string,
    public retryAfter?: number,
  ) {
    super(message);
    this.name = "AppError";
  }
}
const identifier = z.string().min(1).max(128);
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    try {
      return addDays(value, 0) === value;
    } catch {
      return false;
    }
  }, "Enter a valid date.");
const timezoneSchema = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      dateAt(now(), value);
      return !/^[+-]/.test(value);
    } catch {
      return false;
    }
  }, "Choose a valid IANA timezone.");
const nameSchema = z.string().trim().min(1, "Enter a name.").max(80);
const emailSchema = z.string().trim().toLowerCase().email().max(254);
const credentialsSchema = z.object({
  email: emailSchema,
  password: z.string().min(8, "Use at least 8 characters.").max(256),
});
const registrationSchema = credentialsSchema.extend({
  name: nameSchema,
  timezone: timezoneSchema,
});
const taskSchema = z
  .object({
    id: identifier.optional(),
    revision: z.number().int().positive().optional(),
    title: z.string().trim().min(1, "Enter a task title.").max(120),
    description: z.string().trim().max(2000),
    type: z.enum(["binary", "count", "duration"]),
    target: z.number().finite().positive().max(1e12),
    unit: z.string().trim().max(40),
    schedule: z.object({
      kind: z.enum(["daily", "weekdays", "once"]),
      days: z.array(z.number().int().min(1).max(7)).max(7),
    }),
    startDate: dateSchema,
    endDate: dateSchema.nullable(),
    partyId: identifier.nullable(),
    effective: z.enum(["today", "tomorrow"]).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.endDate && value.endDate < value.startDate)
      ctx.addIssue({
        code: "custom",
        message: "End date must follow the start date.",
        path: ["endDate"],
      });
    if (value.schedule.kind === "weekdays" && !value.schedule.days.length)
      ctx.addIssue({
        code: "custom",
        message: "Select at least one weekday.",
        path: ["schedule"],
      });
    if (new Set(value.schedule.days).size !== value.schedule.days.length)
      ctx.addIssue({
        code: "custom",
        message: "Weekdays must be unique.",
        path: ["schedule"],
      });
    if (value.type === "count" && !value.unit)
      ctx.addIssue({
        code: "custom",
        message: "Enter a unit such as pages or reps.",
        path: ["unit"],
      });
    if (value.type !== "binary" && !Number.isInteger(value.target))
      ctx.addIssue({
        code: "custom",
        message: "Use a whole-number target.",
        path: ["target"],
      });
  });
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new AppError(
      400,
      issue.message,
      issue.path.length ? String(issue.path[0]) : undefined,
    );
  }
  return result.data;
}
type UserRow = {
  id: string;
  email: string;
  name: string;
  timezone: string;
  password: string;
  created_at: number;
};
type TaskRow = {
  id: string;
  user_id: string;
  revision: number;
  position: number;
  created_date: string;
  archived_from: string | null;
};
type Definition = Omit<TaskInput, "id" | "revision" | "effective">;
type DayRow = {
  task_id: string;
  user_id: string;
  date: string;
  timezone: string;
  definition: string;
  party_id: string | null;
  value: number;
  logged: number;
  updated_at: number | null;
};
type TimerRow = {
  user_id: string;
  task_id: string;
  started_at: number;
  accounted_at: number;
};
type PartyRow = {
  id: string;
  name: string;
  description: string;
  owner_id: string;
  created_at: number;
};
type InviteRow = {
  id: string;
  party_id: string;
  hash: string;
  expires_at: number;
  revoked: number;
};
function user(id: string): UserRow {
  parse(identifier, id);
  const result = one<UserRow>("SELECT * FROM users WHERE id=?", id);
  if (!result) throw new AppError(401, "Sign in to continue.");
  return result;
}
function profile(row: UserRow): Profile {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    timezone: activeZone(row.id),
  };
}
function activeZone(userId: string, at = now()): string {
  return one<{ timezone: string }>(
    "SELECT timezone FROM user_zones WHERE user_id=? AND effective_at<=? ORDER BY effective_at DESC LIMIT 1",
    userId,
    at,
  )!.timezone;
}
function today(userId: string): string {
  return dateAt(now(), activeZone(userId));
}
function zoneForDay(userId: string, date: string): string {
  const zones = all<{ timezone: string; effective_at: number }>(
    "SELECT timezone,effective_at FROM user_zones WHERE user_id=? ORDER BY effective_at",
    userId,
  );
  let result = zones[0].timezone;
  for (const zone of zones)
    if (dateAt(zone.effective_at, zone.timezone) <= date)
      result = zone.timezone;
  return result;
}
function ownTask(userId: string, taskId: string): TaskRow {
  parse(identifier, taskId);
  const task = one<TaskRow>(
    "SELECT * FROM tasks WHERE id=? AND user_id=?",
    taskId,
    userId,
  );
  if (!task) throw new AppError(404, "Task not found.");
  return task;
}
function definition(taskId: string, date: string): Definition | undefined {
  const row = one<{ definition: string }>(
    "SELECT definition FROM task_versions WHERE task_id=? AND effective_date<=? ORDER BY effective_date DESC LIMIT 1",
    taskId,
    date,
  );
  return row ? JSON.parse(row.definition) : undefined;
}
function scheduled(task: TaskRow, def: Definition, date: string): boolean {
  if (
    date < def.startDate ||
    (def.endDate && date > def.endDate) ||
    (task.archived_from && date >= task.archived_from)
  )
    return false;
  return (
    def.schedule.kind === "daily" ||
    (def.schedule.kind === "once"
      ? date === def.startDate
      : def.schedule.days.includes(weekday(date)))
  );
}
function occurrence(task: TaskRow, date: string): DayRow | undefined {
  const existing = one<DayRow>(
    "SELECT * FROM task_days WHERE task_id=? AND date=?",
    task.id,
    date,
  );
  if (existing) return existing;
  const def = definition(task.id, date);
  if (!def || !scheduled(task, def, date)) return undefined;
  const partyId = date < task.created_date ? null : def.partyId;
  const snapshot = { ...def, partyId };
  if (date > today(task.user_id))
    return {
      task_id: task.id,
      user_id: task.user_id,
      date,
      timezone: zoneForDay(task.user_id, date),
      definition: JSON.stringify(snapshot),
      party_id: partyId,
      value: 0,
      logged: 0,
      updated_at: null,
    };
  run(
    "INSERT OR IGNORE INTO task_days(task_id,user_id,date,timezone,definition,party_id) VALUES(?,?,?,?,?,?)",
    task.id,
    task.user_id,
    date,
    zoneForDay(task.user_id, date),
    JSON.stringify(snapshot),
    partyId,
  );
  return one<DayRow>(
    "SELECT * FROM task_days WHERE task_id=? AND date=?",
    task.id,
    date,
  );
}
function taskRows(userId: string, activeOn?: string): TaskRow[] {
  if (!activeOn)
    return all<TaskRow>(
      "SELECT * FROM tasks WHERE user_id=? ORDER BY position,id",
      userId,
    );
  return all<TaskRow>(
    "SELECT * FROM tasks WHERE user_id=? AND (archived_from IS NULL OR archived_from>?) ORDER BY position,id",
    userId,
    activeOn,
  );
}
function dayRows(userId: string, date: string): DayRow[] {
  const rows: DayRow[] = [];
  for (const task of taskRows(userId, date)) {
    const day = occurrence(task, date);
    if (day) rows.push(day);
  }
  return rows;
}
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
function passwordHash(password: string, salt: string): Promise<Buffer> {
  const { promise, resolve, reject } = Promise.withResolvers<Buffer>();
  scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (error, key) =>
    error ? reject(error) : resolve(key),
  );
  return promise;
}
function session(userId: string): string {
  const token = randomBytes(32).toString("base64url");
  run("DELETE FROM sessions WHERE expires_at<=?", now());
  run(
    "INSERT INTO sessions(hash,user_id,expires_at) VALUES(?,?,?)",
    hash(token),
    userId,
    now() + 30 * 86400000,
  );
  return token;
}
export async function register(
  input: Registration,
): Promise<{ user: Profile; token: string }> {
  const value = parse(registrationSchema, input);
  const salt = randomBytes(16).toString("hex");
  const encoded = `${salt}:${(await passwordHash(value.password, salt)).toString("hex")}`;
  return transaction(() => {
    if (one("SELECT id FROM users WHERE email=?", value.email))
      throw new AppError(
        409,
        "An account with this email already exists.",
        "email",
      );
    const id = randomUUID();
    run(
      "INSERT INTO users(id,email,name,password,timezone,created_at) VALUES(?,?,?,?,?,?)",
      id,
      value.email,
      value.name,
      encoded,
      value.timezone,
      now(),
    );
    run(
      "INSERT INTO user_zones(user_id,effective_at,timezone) VALUES(?,?,?)",
      id,
      0,
      value.timezone,
    );
    return { user: profile(user(id)), token: session(id) };
  });
}
export async function login(
  input: Credentials,
): Promise<{ user: Profile; token: string }> {
  const value = parse(credentialsSchema, input);
  const row = one<UserRow>("SELECT * FROM users WHERE email=?", value.email);
  const [salt, encoded] = row?.password.split(":") || [
    "00000000000000000000000000000000",
    "00".repeat(64),
  ];
  const candidate = await passwordHash(value.password, salt);
  if (!row || !timingSafeEqual(candidate, Buffer.from(encoded, "hex")))
    throw new AppError(401, "Email or password is incorrect.", "password");
  return transaction(() => ({ user: profile(row), token: session(row.id) }));
}
export function getSession(token: string): Profile | null {
  if (typeof token !== "string" || token.length > 256 || !token) return null;
  const row = one<UserRow>(
    "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=? AND s.expires_at>?",
    hash(token),
    now(),
  );
  return row ? profile(row) : null;
}
export function logout(token: string): void {
  if (typeof token === "string")
    run("DELETE FROM sessions WHERE hash=?", hash(token));
}
export function updateProfile(
  userId: string,
  input: { name: string; timezone: string },
): Profile {
  const value = parse(
    z.object({ name: nameSchema, timezone: timezoneSchema }),
    input,
  );
  return transaction(() => {
    const current = user(userId);
    settleTimer(userId);
    dayRows(userId, today(userId));
    const zone = activeZone(userId);
    const effective = midnight(addDays(today(userId), 1), zone);
    run(
      "UPDATE users SET name=?,timezone=? WHERE id=?",
      value.name,
      value.timezone,
      userId,
    );
    run(
      "DELETE FROM user_zones WHERE user_id=? AND effective_at>?",
      userId,
      now(),
    );
    if (value.timezone !== zone)
      run(
        "INSERT INTO user_zones(user_id,effective_at,timezone) VALUES(?,?,?)",
        userId,
        effective,
        value.timezone,
      );
    return profile({ ...current, name: value.name });
  });
}
export function saveTask(userId: string, input: TaskInput): void {
  const value = parse(taskSchema, input);
  transaction(() => {
    user(userId);
    settleTimer(userId);
    if (value.partyId) memberParty(userId, value.partyId);
    const date = today(userId);
    const earliest = addDays(date, -3660);
    const latest = addDays(date, 3660);
    if (value.startDate < earliest || value.startDate > latest)
      throw new AppError(
        400,
        "Choose a start date within ten years of today.",
        "startDate",
      );
    if (
      value.endDate &&
      (value.endDate < earliest || value.endDate > latest)
    )
      throw new AppError(
        400,
        "Choose an end date within ten years of today.",
        "endDate",
      );
    const def: Definition = {
      title: value.title,
      description: value.description,
      type: value.type,
      target: value.type === "binary" ? 1 : value.target,
      unit:
        value.type === "binary"
          ? ""
          : value.type === "duration"
            ? "seconds"
            : value.unit,
      schedule: value.schedule,
      startDate: value.startDate,
      endDate: value.endDate,
      partyId: value.partyId,
    };
    if (!value.id) {
      const total = one<{ count: number }>(
        "SELECT COUNT(*) AS count FROM tasks WHERE user_id=?",
        userId,
      )!.count;
      if (total >= 2000)
        throw new AppError(400, "You have reached the limit of 2000 tasks.");
      const active = one<{ count: number }>(
        "SELECT COUNT(*) AS count FROM tasks WHERE user_id=? AND archived_from IS NULL",
        userId,
      )!.count;
      if (active >= 200)
        throw new AppError(
          400,
          "You can have up to 200 active tasks. Archive one before adding another.",
        );
      const id = randomUUID();
      const position = one<{ position: number }>(
        "SELECT COALESCE(MAX(position),-1)+1 AS position FROM tasks WHERE user_id=?",
        userId,
      )!.position;
      run(
        "INSERT INTO tasks(id,user_id,revision,position,created_date) VALUES(?,?,1,?,?)",
        id,
        userId,
        position,
        date,
      );
      run(
        "INSERT INTO task_versions(task_id,effective_date,definition) VALUES(?,?,?)",
        id,
        value.startDate < date ? value.startDate : date,
        JSON.stringify(def),
      );
      occurrence(ownTask(userId, id), date);
      return;
    }
    const task = ownTask(userId, value.id);
    if (task.archived_from)
      throw new AppError(409, "Archived tasks cannot be edited.");
    if (value.revision !== task.revision)
      throw new AppError(
        409,
        "This task changed on another device. Reload before editing.",
      );
    const existing = occurrence(task, date);
    let effective = value.effective === "tomorrow" ? addDays(date, 1) : date;
    const oldDef = definition(task.id, date);
    if (
      oldDef &&
      oldDef.type !== def.type &&
      ((existing?.logged ?? 0) > 0 ||
        one(
          "SELECT user_id FROM timers WHERE user_id=? AND task_id=?",
          userId,
          task.id,
        ))
    )
      effective = addDays(date, 1);
    run(
      "INSERT INTO task_versions(task_id,effective_date,definition) VALUES(?,?,?) ON CONFLICT(task_id,effective_date) DO UPDATE SET definition=excluded.definition",
      task.id,
      effective,
      JSON.stringify(def),
    );
    if (effective === date) {
      // An explicit edit can revise today's plan, but never publish a private snapshot retroactively.
      const partyId =
        existing && existing.party_id === null ? null : def.partyId;
      if (existing && (scheduled(task, def, date) || existing.logged)) {
        const snapshot = { ...def, partyId };
        run(
          "UPDATE task_days SET definition=?,party_id=? WHERE task_id=? AND date=?",
          JSON.stringify(snapshot),
          partyId,
          task.id,
          date,
        );
      } else if (existing)
        run("DELETE FROM task_days WHERE task_id=? AND date=?", task.id, date);
      else occurrence(task, date);
    }
    run("UPDATE tasks SET revision=revision+1 WHERE id=?", task.id);
  });
}
export function archiveTask(userId: string, id: string): void {
  transaction(() => {
    user(userId);
    const task = ownTask(userId, id);
    settleTimer(userId);
    if (task.archived_from) return;
    occurrence(task, today(userId));
    run(
      "UPDATE tasks SET archived_from=?,revision=revision+1 WHERE id=?",
      addDays(today(userId), 1),
      task.id,
    );
  });
}
export function reorderTasks(userId: string, ids: string[]): void {
  const values = parse(z.array(identifier).max(10000), ids);
  transaction(() => {
    user(userId);
    if (new Set(values).size !== values.length)
      throw new AppError(400, "Task order contains duplicates.");
    const current = taskRows(userId, today(userId));
    if (
      current.length !== values.length ||
      current.some((task) => !values.includes(task.id))
    )
      throw new AppError(
        409,
        "The task list changed. Reload before reordering.",
      );
    values.forEach((id, position) =>
      run(
        "UPDATE tasks SET position=? WHERE id=? AND user_id=?",
        position,
        id,
        userId,
      ),
    );
  });
}
export function logProgress(userId: string, input: ProgressInput): void {
  const value = parse(
    z.object({
      taskId: identifier,
      date: dateSchema,
      operation: z.enum(["set", "add"]),
      value: z.number().finite().min(0).max(1e12),
    }),
    input,
  );
  transaction(() => {
    user(userId);
    settleTimer(userId);
    if (value.date > today(userId))
      throw new AppError(400, "Future progress cannot be logged.", "date");
    const task = ownTask(userId, value.taskId);
    const day = occurrence(task, value.date);
    if (!day)
      throw new AppError(
        400,
        "This task is not scheduled on that date.",
        "date",
      );
    const def = JSON.parse(day.definition) as Definition;
    const result =
      value.operation === "add" ? day.value + value.value : value.value;
    if (
      result > 1e12 ||
      (def.type === "binary" && result !== 0 && result !== 1) ||
      (def.type !== "duration" && !Number.isInteger(value.value))
    )
      throw new AppError(
        400,
        def.type === "binary"
          ? "Yes/no values must be zero or one."
          : "Enter a valid whole-number quantity.",
        "value",
      );
    run(
      `UPDATE task_days SET value=${value.operation === "add" ? "value+?" : "?"},logged=1,updated_at=? WHERE task_id=? AND date=?`,
      value.value,
      now(),
      task.id,
      value.date,
    );
  });
}

function settleTimer(userId: string): void {
  const timer = one<TimerRow>("SELECT * FROM timers WHERE user_id=?", userId);
  if (!timer) return;
  const task = ownTask(userId, timer.task_id);
  const end = now();
  let cursor = timer.accounted_at;
  while (cursor < end) {
    const zone = activeZone(userId, cursor);
    const date = dateAt(cursor, zone);
    const day = occurrence(task, date);
    if (!day) {
      run("DELETE FROM timers WHERE user_id=?", userId);
      return;
    }
    const def = JSON.parse(day.definition) as Definition;
    if (!scheduled(task, def, date) || def.type !== "duration") {
      run("DELETE FROM timers WHERE user_id=?", userId);
      return;
    }
    const nextZone = one<{ effective_at: number }>(
      "SELECT effective_at FROM user_zones WHERE user_id=? AND effective_at>? ORDER BY effective_at LIMIT 1",
      userId,
      cursor,
    );
    const boundary = Math.min(
      end,
      midnight(addDays(date, 1), zone),
      nextZone?.effective_at ?? Infinity,
    );
    if (boundary > cursor)
      run(
        "UPDATE task_days SET value=value+?,logged=1,updated_at=? WHERE task_id=? AND date=?",
        (boundary - cursor) / 1000,
        boundary,
        task.id,
        date,
      );
    cursor = boundary;
  }
  run("UPDATE timers SET accounted_at=? WHERE user_id=?", end, userId);
}
export function timerAction(userId: string, input: TimerInput): void {
  const value = parse(
    z.object({ taskId: identifier, action: z.enum(["start", "pause"]) }),
    input,
  );
  transaction(() => {
    user(userId);
    const task = ownTask(userId, value.taskId);
    settleTimer(userId);
    const current = one<TimerRow>(
      "SELECT * FROM timers WHERE user_id=?",
      userId,
    );
    if (value.action === "pause") {
      if (current && current.task_id !== task.id)
        throw new AppError(409, "A different task's timer is running.");
      run("DELETE FROM timers WHERE user_id=? AND task_id=?", userId, task.id);
      return;
    }
    if (current) {
      if (current.task_id === task.id) return;
      throw new AppError(
        409,
        "Pause the running timer before starting another.",
      );
    }
    const date = today(userId);
    const day = occurrence(task, date);
    if (!day)
      throw new AppError(
        400,
        "Start a timer on a duration task scheduled today.",
      );
    const def = JSON.parse(day.definition) as Definition;
    if (!scheduled(task, def, date) || def.type !== "duration")
      throw new AppError(
        400,
        "Start a timer on a duration task scheduled today.",
      );
    run(
      "INSERT INTO timers(user_id,task_id,started_at,accounted_at) VALUES(?,?,?,?)",
      userId,
      task.id,
      now(),
      now(),
    );
  });
}
function timerState(userId: string): TimerState | null {
  const timer = one<TimerRow>("SELECT * FROM timers WHERE user_id=?", userId);
  if (!timer) return null;
  const def = definition(timer.task_id, today(userId));
  return {
    taskId: timer.task_id,
    title: def?.title || "Timer",
    startedAt: new Date(timer.started_at).toISOString(),
    accountedAt: new Date(timer.accounted_at).toISOString(),
  };
}
function summary(date: string, rows: DayRow[]): DaySummary {
  let completed = 0,
    progress = 0;
  for (const row of rows) {
    const def = JSON.parse(row.definition) as Definition;
    const ratio =
      def.type === "binary"
        ? row.value >= 1
          ? 1
          : 0
        : Math.min(1, row.value / def.target);
    progress += ratio;
    if (ratio >= 1) completed++;
  }
  return {
    date,
    total: rows.length,
    completed,
    percent: rows.length ? (progress / rows.length) * 100 : null,
  };
}
function streak(task: TaskRow, until: string, partyId?: string): number {
  const versions = all<{ effective_date: string; definition: string }>(
    "SELECT effective_date,definition FROM task_versions WHERE task_id=? ORDER BY effective_date",
    task.id,
  );
  if (!versions.length) return 0;
  const days = new Map<
    string,
    { value: number; definition: string; party_id: string | null }
  >();
  for (const row of all<{
    date: string;
    value: number;
    definition: string;
    party_id: string | null;
  }>(
    "SELECT date,value,definition,party_id FROM task_days WHERE task_id=?",
    task.id,
  ))
    days.set(row.date, row);
  let count = 0;
  let index = versions.length - 1;
  // Ten years is enough history for a personal tracker and bounds worst-case
  // work when evaluating a long-running or oddly-dated task.
  const earliest = addDays(until, -3660);
  const firstDate =
    versions[0].effective_date > earliest
      ? versions[0].effective_date
      : earliest;
  for (let date = until; date >= firstDate; date = addDays(date, -1)) {
    while (index > 0 && versions[index].effective_date > date) index--;
    const row = days.get(date);
    const def = JSON.parse(
      row ? row.definition : versions[index].definition,
    ) as Definition;
    if (!scheduled(task, def, date)) continue;
    if (partyId) {
      const snapshotParty = row
        ? row.party_id
        : date < task.created_date
          ? null
          : def.partyId;
      if (snapshotParty !== partyId) continue;
    }
    if (!row || row.value < def.target) break;
    count++;
  }
  return count;
}
function view(
  task: TaskRow,
  row: DayRow,
  partyId?: string,
  detail = true,
): TaskView {
  const def = JSON.parse(row.definition) as Definition;
  const party =
    detail && row.party_id
      ? one<{ name: string }>("SELECT name FROM parties WHERE id=?", row.party_id)
      : undefined;
  const localToday = detail ? today(task.user_id) : "";
  return {
    ...def,
    partyId: row.party_id,
    id: task.id,
    revision: task.revision,
    date: row.date,
    value: row.value,
    percent: Math.min(100, (row.value / def.target) * 100),
    complete: row.value >= def.target,
    streak: detail
      ? streak(task, row.date > localToday ? localToday : row.date, partyId)
      : 0,
    position: task.position,
    archived: !!task.archived_from,
    partyName: party?.name ?? null,
    hasPendingChanges:
      detail &&
      !task.archived_from &&
      (partyId
        ? all<{ definition: string }>(
            "SELECT definition FROM task_versions WHERE task_id=? AND effective_date>?",
            task.id,
            localToday,
          ).some(
            (version) =>
              (JSON.parse(version.definition) as Definition).partyId === partyId,
          )
        : !!one(
            "SELECT task_id FROM task_versions WHERE task_id=? AND effective_date>? LIMIT 1",
            task.id,
            localToday,
          )),
  };
}
export function getDashboard(userId: string, date?: string): Dashboard {
  return transaction(() => {
    const currentUser = user(userId);
    settleTimer(userId);
    const localToday = today(userId);
    const selected = date === undefined ? localToday : parse(dateSchema, date);
    const rows = dayRows(userId, selected);
    const taskById = new Map(
      taskRows(userId, selected).map((task) => [task.id, task]),
    );
    const plannedTasks: TaskView[] = [];
    for (const task of taskRows(userId, localToday)) {
      const latest = one<{ definition: string; effective_date: string }>(
        "SELECT definition,effective_date FROM task_versions WHERE task_id=? ORDER BY effective_date DESC LIMIT 1",
        task.id,
      );
      if (!latest) continue;
      const def = JSON.parse(latest.definition) as Definition;
      const todayRow = occurrence(task, localToday);
      const row: DayRow = {
        task_id: task.id,
        user_id: userId,
        date: localToday,
        timezone: activeZone(userId),
        definition: latest.definition,
        party_id: def.partyId,
        value: todayRow?.value ?? 0,
        logged: 0,
        updated_at: null,
      };
      const planned = view(task, row);
      // Sharing a previously private task keeps today's snapshot private.
      // Surface that as a pending change so "starts tomorrow" is visible.
      if (
        !task.archived_from &&
        todayRow &&
        (todayRow.party_id ?? null) !== (def.partyId ?? null)
      )
        planned.hasPendingChanges = true;
      plannedTasks.push(planned);
    }
    const plannedById = new Map(plannedTasks.map((task) => [task.id, task]));
    const tasks = rows.map((row) => {
      const item = view(taskById.get(row.task_id)!, row);
      if (selected === localToday && plannedById.get(item.id)?.hasPendingChanges)
        item.hasPendingChanges = true;
      return item;
    });
    return {
      user: profile(currentUser),
      date: selected,
      tasks,
      plannedTasks,
      timer: timerState(userId),
      parties: listParties(userId),
      summary: summary(selected, rows),
    };
  });
}
const progressSchema = z.object({
  range: z.enum(["week", "month"]),
  anchor: dateSchema.optional(),
  taskId: identifier.optional(),
});
function progress(
  userId: string,
  input: { range: "week" | "month"; anchor?: string; taskId?: string },
  partyId?: string,
): ProgressData {
  const localToday = today(userId);
  const [startDate, endDate] = period(input.range, input.anchor ?? localToday);
  const tasks = input.taskId
    ? [ownTask(userId, input.taskId)]
    : taskRows(userId, startDate);
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const history: TaskView[] = [],
    days: DaySummary[] = [];
  const totals = new Map<string, number>();
  const taskTotals = new Map<string, number>();
  const stats = new Map<
    string,
    {
      id: string;
      title: string;
      type: Definition["type"];
      unit: string;
    }
  >();
  for (const date of dateRange(startDate, endDate)) {
    const rows: DayRow[] = [];
    for (const task of tasks) {
      const row = occurrence(task, date);
      if (!row || (partyId && row.party_id !== partyId)) continue;
      rows.push(row);
      if (date > localToday) continue;
      const item = view(task, row, partyId, false);
      history.push(item);
      const unit =
        item.type === "duration"
          ? "seconds"
          : item.type === "binary"
            ? "completed tasks"
            : item.unit;
      totals.set(unit, (totals.get(unit) ?? 0) + row.value);
      const key = JSON.stringify([task.id, item.type, unit]);
      taskTotals.set(key, (taskTotals.get(key) ?? 0) + row.value);
      stats.set(key, {
        id: task.id,
        title: item.title,
        type: item.type,
        unit,
      });
    }
    days.push(summary(date, rows));
  }
  const streakUntil = endDate < localToday ? endDate : localToday;
  return {
    range: input.range,
    startDate,
    endDate,
    today: localToday,
    days,
    tasks: [...stats].map(([key, item]) => ({
      ...item,
      streak: streak(taskById.get(item.id)!, streakUntil, partyId),
      total: taskTotals.get(key) ?? 0,
    })),
    totals: [...totals].map(([unit, value]) => ({ unit, value })),
    history,
  };
}
export function getProgress(
  userId: string,
  input: { range: "week" | "month"; anchor?: string; taskId?: string },
): ProgressData {
  const value = parse(progressSchema, input);
  return transaction(() => {
    user(userId);
    settleTimer(userId);
    return progress(userId, value);
  });
}
export function isTaskShared(
  userId: string,
  taskId: string,
  date?: string,
): boolean {
  return transaction(() => {
    user(userId);
    const task = ownTask(userId, taskId);
    const selected =
      date === undefined ? today(userId) : parse(dateSchema, date);
    const snapshot = occurrence(task, selected);
    return !!snapshot?.party_id || !!definition(task.id, selected)?.partyId;
  });
}

function memberParty(userId: string, partyId: string): PartyRow {
  parse(identifier, partyId);
  const party = one<PartyRow>(
    "SELECT p.* FROM parties p JOIN members m ON m.party_id=p.id WHERE p.id=? AND m.user_id=?",
    partyId,
    userId,
  );
  if (!party)
    throw new AppError(404, "Party not found or you no longer have access.");
  return party;
}
function ownerParty(userId: string, partyId: string): PartyRow {
  const party = memberParty(userId, partyId);
  if (party.owner_id !== userId)
    throw new AppError(403, "Only the party owner can do that.");
  return party;
}
function sharedMember(memberId: string, partyId: string): PartyMember {
  const current = user(memberId);
  settleTimer(memberId);
  const date = today(memberId);
  const rows = dayRows(memberId, date).filter(
    (row) => row.party_id === partyId,
  );
  const stats = summary(date, rows);
  const tasks = taskRows(memberId, date);
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  return {
    id: memberId,
    name: current.name,
    timezone: activeZone(memberId),
    date,
    percent: stats.percent,
    completed: stats.completed,
    total: stats.total,
    tasks: rows.map((row) =>
      view(taskById.get(row.task_id)!, row, partyId, false),
    ),
  };
}
function partySummary(
  userId: string,
  party: PartyRow,
  members?: PartyMember[],
): PartySummary {
  const memberList =
    members ??
    all<{ user_id: string }>(
      "SELECT user_id FROM members WHERE party_id=?",
      party.id,
    ).map((member) => sharedMember(member.user_id, party.id));
  const percents = memberList
    .map((member) => member.percent)
    .filter((value): value is number => value !== null);
  return {
    id: party.id,
    name: party.name,
    description: party.description,
    ownerId: party.owner_id,
    role: party.owner_id === userId ? "owner" : "member",
    memberCount: memberList.length,
    percent: percents.length
      ? percents.reduce((a, b) => a + b, 0) / percents.length
      : null,
  };
}
export function listParties(userId: string): PartySummary[] {
  return transaction(() => {
    user(userId);
    return all<PartyRow>(
      "SELECT p.* FROM parties p JOIN members m ON m.party_id=p.id WHERE m.user_id=? ORDER BY p.created_at,p.id",
      userId,
    ).map((party) => partySummary(userId, party));
  });
}
const partySchema = z.object({
  name: nameSchema,
  description: z.string().trim().max(1000),
});
export function createParty(
  userId: string,
  input: { name: string; description: string },
): PartySummary {
  const value = parse(partySchema, input);
  return transaction(() => {
    user(userId);
    const owned = one<{ count: number }>(
      "SELECT COUNT(*) AS count FROM parties WHERE owner_id=?",
      userId,
    )!.count;
    if (owned >= 20)
      throw new AppError(400, "You can own up to 20 parties.");
    const id = randomUUID();
    run(
      "INSERT INTO parties(id,name,description,owner_id,created_at) VALUES(?,?,?,?,?)",
      id,
      value.name,
      value.description,
      userId,
      now(),
    );
    run(
      "INSERT INTO members(party_id,user_id,joined_at) VALUES(?,?,?)",
      id,
      userId,
      now(),
    );
    return partySummary(userId, memberParty(userId, id));
  });
}
export function getParty(userId: string, partyId: string): PartyDetail {
  return transaction(() => {
    user(userId);
    const party = memberParty(userId, partyId);
    const members = all<{ user_id: string }>(
      "SELECT user_id FROM members WHERE party_id=? ORDER BY joined_at,user_id",
      partyId,
    ).map((member) => sharedMember(member.user_id, partyId));
    const activity = all<DayRow & { name: string }>(
      "SELECT d.*,u.name FROM task_days d JOIN users u ON u.id=d.user_id JOIN members m ON m.user_id=d.user_id AND m.party_id=d.party_id WHERE d.party_id=? AND d.logged=1 AND d.updated_at IS NOT NULL ORDER BY d.updated_at DESC,d.task_id LIMIT 30",
      partyId,
    ).map((row) => {
      const def = JSON.parse(row.definition) as Definition;
      return {
        id: `${row.task_id}:${row.date}`,
        memberId: row.user_id,
        name: row.name,
        title: def.title,
        value: row.value,
        target: def.target,
        type: def.type,
        unit: def.unit,
        updatedAt: new Date(row.updated_at!).toISOString(),
      };
    });
    const invites =
      party.owner_id === userId
        ? all<InviteRow>(
            "SELECT * FROM invites WHERE party_id=? ORDER BY expires_at DESC",
            partyId,
          ).map((invite) => ({
            id: invite.id,
            expiresAt: new Date(invite.expires_at).toISOString(),
            revoked: !!invite.revoked,
          }))
        : [];
    return {
      ...partySummary(userId, party, members),
      members,
      activity,
      invites,
    };
  });
}
export function updateParty(
  userId: string,
  partyId: string,
  input: { name: string; description: string },
): void {
  const value = parse(partySchema, input);
  transaction(() => {
    user(userId);
    ownerParty(userId, partyId);
    run(
      "UPDATE parties SET name=?,description=? WHERE id=?",
      value.name,
      value.description,
      partyId,
    );
  });
}
export function createInvite(
  userId: string,
  partyId: string,
): { id: string; token: string; expiresAt: string } {
  return transaction(() => {
    user(userId);
    ownerParty(userId, partyId);
    run(
      "DELETE FROM invites WHERE party_id=? AND (revoked=1 OR expires_at<=?)",
      partyId,
      now(),
    );
    const active = one<{ count: number }>(
      "SELECT COUNT(*) AS count FROM invites WHERE party_id=?",
      partyId,
    )!.count;
    if (active >= 50)
      throw new AppError(
        400,
        "This party has reached its active invitation limit.",
      );
    const id = randomUUID(),
      token = randomBytes(32).toString("base64url"),
      expiresAt = now() + 7 * 86400000;
    run(
      "INSERT INTO invites(id,party_id,hash,expires_at) VALUES(?,?,?,?)",
      id,
      partyId,
      hash(token),
      expiresAt,
    );
    return { id, token, expiresAt: new Date(expiresAt).toISOString() };
  });
}
export function revokeInvite(
  userId: string,
  partyId: string,
  inviteId: string,
): void {
  parse(identifier, inviteId);
  transaction(() => {
    user(userId);
    ownerParty(userId, partyId);
    if (
      !run(
        "UPDATE invites SET revoked=1 WHERE id=? AND party_id=?",
        inviteId,
        partyId,
      ).changes
    )
      throw new AppError(404, "Invitation not found.");
  });
}
function validInvite(token: string): InviteRow {
  const value = parse(z.string().min(32).max(128), token);
  const invite = one<InviteRow>(
    "SELECT * FROM invites WHERE hash=?",
    hash(value),
  );
  if (!invite || invite.revoked || invite.expires_at <= now())
    throw new AppError(404, "This invitation is invalid, expired, or revoked.");
  return invite;
}
export function previewInvite(token: string): InvitePreview {
  const invite = validInvite(token);
  const party = one<PartyRow>(
    "SELECT * FROM parties WHERE id=?",
    invite.party_id,
  )!;
  return {
    partyName: party.name,
    description: party.description,
    memberCount: one<{ count: number }>(
      "SELECT COUNT(*) AS count FROM members WHERE party_id=?",
      party.id,
    )!.count,
    expiresAt: new Date(invite.expires_at).toISOString(),
  };
}
export function joinParty(userId: string, token: string): { partyId: string } {
  return transaction(() => {
    user(userId);
    const invite = validInvite(token);
    run(
      "INSERT OR IGNORE INTO members(party_id,user_id,joined_at) VALUES(?,?,?)",
      invite.party_id,
      userId,
      now(),
    );
    return { partyId: invite.party_id };
  });
}
function detachMember(userId: string, partyId: string): void {
  settleTimer(userId);
  const date = today(userId);
  // Keep personal snapshots, but future definitions must not re-share on rejoining.
  for (const task of taskRows(userId)) {
    occurrence(task, date);
    const versions = all<{ effective_date: string; definition: string }>(
      "SELECT effective_date,definition FROM task_versions WHERE task_id=? AND effective_date>=?",
      task.id,
      date,
    );
    const current = definition(task.id, date);
    if (current?.partyId === partyId) {
      run(
        "INSERT INTO task_versions(task_id,effective_date,definition) VALUES(?,?,?) ON CONFLICT(task_id,effective_date) DO UPDATE SET definition=excluded.definition",
        task.id,
        date,
        JSON.stringify({ ...current, partyId: null }),
      );
      run(
        "UPDATE task_days SET party_id=NULL,definition=json_set(definition,'$.partyId',NULL) WHERE task_id=? AND date>=? AND party_id=?",
        task.id,
        date,
        partyId,
      );
    }
    let changed = current?.partyId === partyId;
    for (const version of versions) {
      const def = JSON.parse(version.definition) as Definition;
      if (def.partyId !== partyId) continue;
      run(
        "UPDATE task_versions SET definition=? WHERE task_id=? AND effective_date=?",
        JSON.stringify({ ...def, partyId: null }),
        task.id,
        version.effective_date,
      );
      changed = true;
    }
    if (changed)
      run("UPDATE tasks SET revision=revision+1 WHERE id=?", task.id);
  }
  run("DELETE FROM members WHERE party_id=? AND user_id=?", partyId, userId);
}
export function manageMembership(
  userId: string,
  partyId: string,
  input: MembershipInput,
): void {
  const value = parse(
    z.object({
      action: z.enum(["leave", "remove", "transfer"]),
      memberId: identifier.optional(),
    }),
    input,
  );
  transaction(() => {
    user(userId);
    const party = memberParty(userId, partyId);
    if (value.action === "leave") {
      const count = one<{ count: number }>(
        "SELECT COUNT(*) AS count FROM members WHERE party_id=?",
        partyId,
      )!.count;
      if (party.owner_id === userId && count > 1)
        throw new AppError(409, "Transfer ownership before leaving.");
      detachMember(userId, partyId);
      if (party.owner_id === userId)
        run("DELETE FROM parties WHERE id=?", partyId);
      return;
    }
    ownerParty(userId, partyId);
    if (!value.memberId)
      throw new AppError(400, "Choose a member.", "memberId");
    if (value.memberId === userId)
      throw new AppError(400, "Choose another member.", "memberId");
    if (
      !one(
        "SELECT user_id FROM members WHERE party_id=? AND user_id=?",
        partyId,
        value.memberId,
      )
    )
      throw new AppError(404, "Member not found.");
    if (value.action === "transfer")
      run("UPDATE parties SET owner_id=? WHERE id=?", value.memberId, partyId);
    else detachMember(value.memberId, partyId);
  });
}
export function getMemberHistory(
  userId: string,
  partyId: string,
  memberId: string,
  input: { range: "week" | "month"; anchor?: string },
): ProgressData {
  const value = parse(progressSchema.omit({ taskId: true }), input);
  parse(identifier, memberId);
  return transaction(() => {
    user(userId);
    memberParty(userId, partyId);
    memberParty(memberId, partyId);
    settleTimer(memberId);
    return progress(memberId, value, partyId);
  });
}
export function getAudience(userId: string): string[] {
  user(userId);
  return all<{ user_id: string }>(
    "SELECT DISTINCT other.user_id FROM members own JOIN members other ON other.party_id=own.party_id WHERE own.user_id=?",
    userId,
  )
    .map((member) => member.user_id)
    .filter((id) => id !== userId)
    .concat(userId);
}
