import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import type { TaskInput } from "../src/shared/types";

const taskDefaults: TaskInput = {
  title: "Read",
  description: "",
  type: "count",
  target: 10,
  unit: "pages",
  schedule: { kind: "daily", days: [] },
  startDate: "2026-03-02",
  endDate: null,
  partyId: null,
};

test("persistent account, personal history, timers, and private-party boundaries", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "one-percent-store-"));
  process.env.DATABASE_PATH = join(directory, "test.sqlite");
  t.mock.timers.enable({
    apis: ["Date"],
    now: new Date("2026-03-02T12:00:00Z"),
  });
  // Import after DATABASE_PATH is set: this test intentionally exercises database initialization.
  const store = await import("../src/server/store");
  const { getDatabase } = await import("../src/server/db");
  const db = getDatabase();
  t.after(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  let serial = 0;
  async function account(timezone = "UTC") {
    serial++;
    return store.register({
      name: `Person ${serial}`,
      email: `person${serial}@example.com`,
      password: "correct horse battery staple",
      timezone,
    });
  }
  function create(userId: string, overrides: Partial<TaskInput> = {}) {
    const before = new Set(
      store.getDashboard(userId).plannedTasks.map((task) => task.id),
    );
    store.saveTask(userId, { ...taskDefaults, ...overrides });
    return store
      .getDashboard(userId)
      .plannedTasks.find((task) => !before.has(task.id))!;
  }
  function setClock(iso: string) {
    t.mock.timers.setTime(new Date(iso).getTime());
  }
  function status(expected: number) {
    return (error: unknown) =>
      error instanceof store.AppError && error.status === expected;
  }

  await t.test(
    "auth hashes credentials and sessions, validates input, and expires/revokes sessions",
    async () => {
      const a = await account();
      assert.equal(store.getSession(a.token)?.id, a.user.id);
      assert.equal(store.getSession("invalid"), null);
      const stored = db
        .prepare("SELECT password FROM users WHERE id=?")
        .get(a.user.id) as { password: string };
      assert.ok(!stored.password.includes("correct horse"));
      const storedSession = db
        .prepare("SELECT hash FROM sessions WHERE user_id=?")
        .get(a.user.id) as { hash: string };
      assert.notEqual(storedSession.hash, a.token);
      await assert.rejects(
        store.login({ email: a.user.email, password: "wrong password" }),
        status(401),
      );
      await assert.rejects(
        store.register({
          name: "Other",
          email: a.user.email.toUpperCase(),
          password: "another password",
          timezone: "UTC",
        }),
        status(409),
      );
      assert.throws(
        () => store.saveTask(a.user.id, null as unknown as TaskInput),
        status(400),
      );
      assert.throws(
        () =>
          store.updateProfile(a.user.id, {
            name: "Valid",
            timezone: "Not/AZone",
          }),
        status(400),
      );
      const signedIn = await store.login({
        email: `  ${a.user.email.toUpperCase()} `,
        password: "correct horse battery staple",
      });
      store.logout(signedIn.token);
      assert.equal(store.getSession(signedIn.token), null);
      db.prepare("UPDATE sessions SET expires_at=? WHERE user_id=?").run(
        Date.now(),
        a.user.id,
      );
      assert.equal(store.getSession(a.token), null);
    },
  );

  await t.test(
    "task dates stay within a bounded, useful range",
    async () => {
      const a = await account();
      assert.throws(
        () =>
          store.saveTask(a.user.id, {
            ...taskDefaults,
            startDate: "0001-01-01",
          }),
        status(400),
      );
      assert.throws(
        () =>
          store.saveTask(a.user.id, {
            ...taskDefaults,
            startDate: "9999-12-31",
          }),
        status(400),
      );
      assert.throws(
        () =>
          store.saveTask(a.user.id, {
            ...taskDefaults,
            endDate: "9999-12-31",
          }),
        status(400),
      );
    },
  );

  await t.test(
    "atomic quantities, corrections, revision conflicts, and cross-user ownership",
    async () => {
      const a = await account(),
        b = await account();
      const task = create(a.user.id);
      store.logProgress(a.user.id, {
        taskId: task.id,
        date: "2026-03-02",
        operation: "add",
        value: 15,
      });
      let day = store.getDashboard(a.user.id).tasks[0];
      assert.equal(day.value, 15);
      assert.equal(day.percent, 100);
      store.logProgress(a.user.id, {
        taskId: task.id,
        date: "2026-03-02",
        operation: "set",
        value: 4,
      });
      day = store.getDashboard(a.user.id).tasks[0];
      assert.equal(day.value, 4);
      assert.equal(day.percent, 40);
      assert.throws(
        () =>
          store.logProgress(b.user.id, {
            taskId: task.id,
            date: "2026-03-02",
            operation: "add",
            value: 1,
          }),
        status(404),
      );
      assert.throws(() => store.archiveTask(b.user.id, task.id), status(404));
      assert.throws(
        () => store.getProgress(b.user.id, { range: "week", taskId: task.id }),
        status(404),
      );
      store.saveTask(a.user.id, {
        ...task,
        title: "Read more",
        target: 20,
        effective: "tomorrow",
      });
      assert.throws(
        () => store.saveTask(a.user.id, { ...task, title: "Stale edit" }),
        status(409),
      );
      assert.equal(store.getDashboard(a.user.id).tasks[0].target, 10);
      assert.equal(
        store.getDashboard(a.user.id).tasks[0].hasPendingChanges,
        true,
      );
      assert.throws(
        () =>
          store.logProgress(a.user.id, {
            taskId: task.id,
            date: "2026-03-03",
            operation: "add",
            value: 1,
          }),
        status(400),
      );
      assert.throws(
        () => store.reorderTasks(a.user.id, [task.id, task.id]),
        status(400),
      );
    },
  );

  await t.test(
    "missed scheduled days, rest days, snapshots, forced type cutover, and archive",
    async () => {
      const a = await account();
      const task = create(a.user.id, {
        schedule: { kind: "weekdays", days: [1, 3, 5] },
      });
      store.logProgress(a.user.id, {
        taskId: task.id,
        date: "2026-03-02",
        operation: "set",
        value: 10,
      });
      store.saveTask(a.user.id, {
        ...task,
        type: "duration",
        unit: "seconds",
        target: 600,
        effective: "today",
      });
      assert.equal(store.getDashboard(a.user.id).tasks[0].type, "count");
      assert.equal(store.getDashboard(a.user.id).plannedTasks[0].target, 600);
      assert.equal(
        store.getDashboard(a.user.id).plannedTasks[0].type,
        "duration",
      );
      // Viewing the future must not freeze its definition before a subsequent edit.
      assert.equal(
        store.getDashboard(a.user.id, "2026-03-04").tasks[0].target,
        600,
      );
      const latest = store.getDashboard(a.user.id).plannedTasks[0];
      store.saveTask(a.user.id, {
        ...latest,
        type: "duration",
        unit: "seconds",
        target: 900,
        effective: "tomorrow",
      });
      setClock("2026-03-06T12:00:00Z");
      const week = store.getProgress(a.user.id, {
        range: "week",
        anchor: "2026-03-04",
      });
      assert.equal(
        week.history.find((row) => row.date === "2026-03-02")?.target,
        10,
      );
      assert.equal(
        week.history.find((row) => row.date === "2026-03-04")?.target,
        900,
      );
      assert.equal(
        week.history.find((row) => row.date === "2026-03-04")?.value,
        0,
      );
      assert.equal(
        week.days.find((row) => row.date === "2026-03-03")?.percent,
        null,
      );
      assert.equal(
        week.days.find((row) => row.date === "2026-03-04")?.percent,
        0,
      );
      store.archiveTask(a.user.id, task.id);
      assert.equal(store.getDashboard(a.user.id).tasks.length, 1);
      setClock("2026-03-09T12:00:00Z");
      assert.equal(store.getDashboard(a.user.id).tasks.length, 0);
      store.archiveTask(a.user.id, task.id);
      assert.equal(store.getDashboard(a.user.id).tasks.length, 0);
      assert.equal(store.getDashboard(a.user.id, "2026-03-06").tasks.length, 1);
      setClock("2026-03-02T12:00:00Z");
    },
  );

  await t.test(
    "equal task weighting, compatible totals, once schedules, and rest-day editing",
    async () => {
      const a = await account();
      const pages = create(a.user.id);
      const done = create(a.user.id, {
        title: "Finished",
        type: "binary",
        target: 1,
        unit: "",
        schedule: { kind: "once", days: [] },
      });
      const reps = create(a.user.id, {
        title: "Exercise",
        unit: "reps",
        target: 20,
      });
      store.logProgress(a.user.id, {
        taskId: pages.id,
        date: "2026-03-02",
        operation: "set",
        value: 5,
      });
      store.logProgress(a.user.id, {
        taskId: done.id,
        date: "2026-03-02",
        operation: "set",
        value: 1,
      });
      store.logProgress(a.user.id, {
        taskId: reps.id,
        date: "2026-03-02",
        operation: "set",
        value: 0,
      });
      assert.equal(store.getDashboard(a.user.id).summary.percent, 50);
      const result = store.getProgress(a.user.id, {
        range: "month",
        anchor: "2026-03-02",
      });
      assert.equal(
        result.totals.find((total) => total.unit === "pages")?.value,
        5,
      );
      assert.equal(
        result.totals.find((total) => total.unit === "reps")?.value,
        0,
      );
      assert.equal(
        result.totals.find((total) => total.unit === "completed tasks")?.value,
        1,
      );
      assert.equal(
        result.history.filter((row) => row.id === done.id).length,
        1,
      );
      assert.ok(
        result.history.every((row) => row.date <= result.today),
        "Future plans must not appear as historical records.",
      );
      assert.equal(
        result.days.find((day) => day.date === "2026-03-03")?.total,
        2,
      );
      const b = await account();
      const weekend = create(b.user.id, {
        schedule: { kind: "weekdays", days: [7] },
      });
      const dashboard = store.getDashboard(b.user.id);
      assert.equal(dashboard.tasks.length, 0);
      assert.equal(dashboard.plannedTasks[0].id, weekend.id);
      assert.equal(dashboard.summary.percent, null);
      store.reorderTasks(a.user.id, [reps.id, done.id, pages.id]);
      assert.equal(store.getDashboard(a.user.id).plannedTasks[0].id, reps.id);
    },
  );

  await t.test(
    "streaks ignore rest days and break on missed scheduled occurrences",
    async () => {
      const a = await account();
      const task = create(a.user.id, {
        type: "binary",
        target: 1,
        unit: "",
        schedule: { kind: "weekdays", days: [1, 3, 5] },
      });
      store.logProgress(a.user.id, {
        taskId: task.id,
        date: "2026-03-02",
        operation: "set",
        value: 1,
      });
      setClock("2026-03-04T12:00:00Z");
      store.logProgress(a.user.id, {
        taskId: task.id,
        date: "2026-03-04",
        operation: "set",
        value: 1,
      });
      assert.equal(store.getDashboard(a.user.id).tasks[0].streak, 2);
      setClock("2026-03-09T12:00:00Z");
      store.logProgress(a.user.id, {
        taskId: task.id,
        date: "2026-03-09",
        operation: "set",
        value: 1,
      });
      assert.equal(store.getDashboard(a.user.id).tasks[0].streak, 1);
      setClock("2026-03-02T12:00:00Z");
    },
  );

  await t.test(
    "timer single flight, repeated starts, pause/resume, and spring-DST midnight splitting",
    async () => {
      setClock("2026-03-08T04:59:30Z"); // New York: March 7, 23:59:30.
      const a = await account("America/New_York");
      const task = create(a.user.id, {
        type: "duration",
        target: 3600,
        unit: "seconds",
        startDate: "2026-03-07",
      });
      const other = create(a.user.id, {
        title: "Other timer",
        type: "duration",
        target: 60,
        unit: "seconds",
        startDate: "2026-03-07",
      });
      store.timerAction(a.user.id, { taskId: task.id, action: "start" });
      store.timerAction(a.user.id, { taskId: task.id, action: "start" });
      assert.throws(
        () =>
          store.timerAction(a.user.id, { taskId: other.id, action: "start" }),
        status(409),
      );
      setClock("2026-03-08T05:00:30Z");
      let dashboard = store.getDashboard(a.user.id);
      assert.equal(
        dashboard.tasks.find((row) => row.id === task.id)?.value,
        30,
      );
      assert.equal(
        store
          .getDashboard(a.user.id, "2026-03-07")
          .tasks.find((row) => row.id === task.id)?.value,
        30,
      );
      assert.equal(
        store.getDashboard(a.user.id).tasks.find((row) => row.id === task.id)
          ?.value,
        30,
      );
      assert.ok(dashboard.timer);
      setClock("2026-03-09T04:00:30Z"); // March 8 was 23 hours long.
      store.timerAction(a.user.id, { taskId: task.id, action: "pause" });
      assert.equal(
        store
          .getDashboard(a.user.id, "2026-03-08")
          .tasks.find((row) => row.id === task.id)?.value,
        23 * 3600,
      );
      assert.equal(
        store.getDashboard(a.user.id).tasks.find((row) => row.id === task.id)
          ?.value,
        30,
      );
      assert.equal(store.getDashboard(a.user.id).timer, null);
      store.timerAction(a.user.id, { taskId: task.id, action: "start" });
      setClock("2026-03-09T04:00:40Z");
      store.timerAction(a.user.id, { taskId: task.id, action: "pause" });
      assert.equal(
        store.getDashboard(a.user.id).tasks.find((row) => row.id === task.id)
          ?.value,
        40,
      );
      setClock("2026-03-02T12:00:00Z");
    },
  );

  await t.test(
    "a timer stops at the next unscheduled day without losing the previous day's work",
    async () => {
      setClock("2026-03-02T23:59:30Z");
      const a = await account();
      const task = create(a.user.id, {
        type: "duration",
        target: 60,
        unit: "seconds",
        schedule: { kind: "weekdays", days: [1] },
      });
      store.timerAction(a.user.id, { taskId: task.id, action: "start" });
      setClock("2026-03-03T00:00:30Z");
      const next = store.getDashboard(a.user.id);
      assert.equal(next.timer, null);
      assert.deepEqual(next.tasks, []);
      assert.equal(
        store.getDashboard(a.user.id, "2026-03-02").tasks[0].value,
        30,
      );
      setClock("2026-03-02T12:00:00Z");
    },
  );

  await t.test(
    "editing a schedule stops a running timer that no longer applies",
    async () => {
      setClock("2026-03-02T12:00:00Z");
      const a = await account();
      const task = create(a.user.id, {
        type: "duration",
        target: 3600,
        unit: "seconds",
      });
      store.timerAction(a.user.id, { taskId: task.id, action: "start" });
      setClock("2026-03-02T12:00:10Z");
      const latest = store
        .getDashboard(a.user.id)
        .plannedTasks.find((row) => row.id === task.id)!;
      store.saveTask(a.user.id, {
        ...latest,
        schedule: { kind: "weekdays", days: [2] },
        effective: "today",
      });
      setClock("2026-03-02T12:00:20Z");
      const dashboard = store.getDashboard(a.user.id);
      assert.equal(dashboard.timer, null);
      assert.equal(
        store
          .getDashboard(a.user.id, "2026-03-02")
          .tasks.find((row) => row.id === task.id)?.value,
        10,
      );
      assert.throws(
        () => store.timerAction(a.user.id, { taskId: task.id, action: "start" }),
        status(400),
      );
      setClock("2026-03-02T12:00:00Z");
    },
  );

  await t.test(
    "fall-DST timer day is 25 hours and profile timezone changes are future-only",
    async () => {
      setClock("2026-11-01T03:59:30Z");
      const a = await account("America/New_York");
      const task = create(a.user.id, {
        type: "duration",
        target: 3600,
        unit: "seconds",
        startDate: "2026-10-31",
      });
      store.timerAction(a.user.id, { taskId: task.id, action: "start" });
      setClock("2026-11-02T05:00:30Z");
      store.timerAction(a.user.id, { taskId: task.id, action: "pause" });
      assert.equal(
        store.getDashboard(a.user.id, "2026-11-01").tasks[0].value,
        25 * 3600,
      );
      const before = db
        .prepare("SELECT timezone FROM task_days WHERE task_id=? AND date=?")
        .get(task.id, "2026-11-01") as { timezone: string };
      store.updateProfile(a.user.id, {
        name: "Updated name",
        timezone: "Asia/Tokyo",
      });
      assert.equal(
        store.getDashboard(a.user.id).user.timezone,
        "America/New_York",
      );
      setClock("2026-11-03T05:01:00Z");
      assert.equal(store.getDashboard(a.user.id).user.timezone, "Asia/Tokyo");
      const after = db
        .prepare("SELECT timezone FROM task_days WHERE task_id=? AND date=?")
        .get(task.id, "2026-11-01") as { timezone: string };
      assert.equal(after.timezone, before.timezone);
      setClock("2026-03-02T12:00:00Z");
    },
  );

  await t.test(
    "invite roles, private snapshots, authorized history, live timers, and removal",
    async () => {
      const a = await account(),
        b = await account("America/Los_Angeles"),
        outsider = await account();
      const party = store.createParty(a.user.id, {
        name: "Our party",
        description: "Private",
      });
      assert.throws(
        () => store.getParty(outsider.user.id, party.id),
        status(404),
      );
      assert.throws(
        () =>
          store.getMemberHistory(outsider.user.id, party.id, a.user.id, {
            range: "week",
          }),
        status(404),
      );
      const invite = store.createInvite(a.user.id, party.id);
      assert.equal(store.previewInvite(invite.token).partyName, "Our party");
      assert.ok(
        !JSON.stringify(store.getParty(a.user.id, party.id)).includes(
          invite.token,
        ),
      );
      store.joinParty(b.user.id, invite.token);
      store.joinParty(b.user.id, invite.token);
      assert.equal(store.getParty(a.user.id, party.id).memberCount, 2);
      assert.throws(() => store.createInvite(b.user.id, party.id), status(403));
      assert.throws(
        () =>
          store.updateParty(b.user.id, party.id, {
            name: "Hijack",
            description: "",
          }),
        status(403),
      );
      assert.throws(
        () => store.manageMembership(a.user.id, party.id, { action: "leave" }),
        status(409),
      );
      const privateTask = create(a.user.id, { title: "Private" });
      store.logProgress(a.user.id, {
        taskId: privateTask.id,
        date: "2026-03-02",
        operation: "set",
        value: 10,
      });
      store.saveTask(a.user.id, {
        ...privateTask,
        partyId: party.id,
        effective: "today",
      });
      const shared = create(a.user.id, { title: "Shared", partyId: party.id });
      store.logProgress(a.user.id, {
        taskId: shared.id,
        date: "2026-03-02",
        operation: "set",
        value: 5,
      });
      let detail = store.getParty(b.user.id, party.id);
      let owner = detail.members.find((member) => member.id === a.user.id)!;
      assert.equal(owner.total, 1);
      assert.equal(owner.percent, 50);
      assert.ok(
        detail.activity.every((activity) => activity.title !== "Private"),
      );
      const history = store.getMemberHistory(b.user.id, party.id, a.user.id, {
        range: "week",
        anchor: "2026-03-02",
      });
      assert.ok(
        history.history
          .filter((row) => row.date <= "2026-03-02")
          .every((row) => row.title !== "Private"),
      );
      const timer = create(a.user.id, {
        title: "Shared timer",
        type: "duration",
        target: 60,
        unit: "seconds",
        partyId: party.id,
      });
      store.timerAction(a.user.id, { taskId: timer.id, action: "start" });
      setClock("2026-03-02T12:00:15Z");
      detail = store.getParty(b.user.id, party.id);
      owner = detail.members.find((member) => member.id === a.user.id)!;
      assert.equal(owner.tasks.find((row) => row.id === timer.id)?.value, 15);
      store.timerAction(a.user.id, { taskId: timer.id, action: "pause" });
      store.manageMembership(a.user.id, party.id, {
        action: "remove",
        memberId: b.user.id,
      });
      assert.throws(() => store.getParty(b.user.id, party.id), status(404));
      assert.throws(
        () =>
          store.getMemberHistory(b.user.id, party.id, a.user.id, {
            range: "week",
          }),
        status(404),
      );
      assert.deepEqual(store.getAudience(a.user.id), [a.user.id]);
      store.revokeInvite(a.user.id, party.id, invite.id);
      assert.throws(() => store.previewInvite(invite.token), status(404));
      const expired = store.createInvite(a.user.id, party.id);
      db.prepare("UPDATE invites SET expires_at=? WHERE id=?").run(
        Date.now(),
        expired.id,
      );
      assert.throws(
        () => store.joinParty(b.user.id, expired.token),
        status(404),
      );
      const next = store.createInvite(a.user.id, party.id);
      store.joinParty(b.user.id, next.token);
      store.manageMembership(a.user.id, party.id, {
        action: "transfer",
        memberId: b.user.id,
      });
      assert.throws(() => store.createInvite(a.user.id, party.id), status(403));
      store.manageMembership(a.user.id, party.id, { action: "leave" });
      assert.throws(() => store.getParty(a.user.id, party.id), status(404));
      assert.equal(
        store.getDashboard(a.user.id).tasks.find((row) => row.id === shared.id)
          ?.value,
        5,
      );
      store.manageMembership(b.user.id, party.id, { action: "leave" });
      assert.throws(() => store.previewInvite(next.token), status(404));
      setClock("2026-03-02T12:00:00Z");
    },
  );

  await t.test(
    "account resource caps bound parties, tasks, and active invitations",
    async () => {
      const partyOwner = await account();
      for (let index = 0; index < 20; index++)
        store.createParty(partyOwner.user.id, {
          name: `Party ${index}`,
          description: "",
        });
      assert.throws(
        () =>
          store.createParty(partyOwner.user.id, {
            name: "One too many",
            description: "",
          }),
        status(400),
      );

      const inviteOwner = await account();
      const party = store.createParty(inviteOwner.user.id, {
        name: "Invite cap",
        description: "",
      });
      for (let index = 0; index < 50; index++)
        store.createInvite(inviteOwner.user.id, party.id);
      assert.throws(
        () => store.createInvite(inviteOwner.user.id, party.id),
        status(400),
      );

      const taskOwner = await account();
      const insert = db.prepare(
        "INSERT INTO tasks(id,user_id,revision,position,created_date,archived_from) VALUES(?,?,1,?,?,NULL)",
      );
      db.exec("BEGIN");
      for (let index = 0; index < 2000; index++)
        insert.run(
          `cap-${index}-${taskOwner.user.id}`,
          taskOwner.user.id,
          index,
          "2026-03-02",
        );
      db.exec("COMMIT");
      assert.throws(
        () => store.saveTask(taskOwner.user.id, { ...taskDefaults }),
        status(400),
      );
    },
  );

  await t.test(
    "SQLite persists sessions, tasks, and concurrent increments across processes",
    async () => {
      const a = await account();
      const task = create(a.user.id, { target: 1000 });
      const moduleURL = pathToFileURL(
        join(process.cwd(), "src/server/store.ts"),
      ).href;
      const instant = Date.now();
      function processJob(script: string): Promise<string> {
        const { promise, resolve, reject } = Promise.withResolvers<string>();
        const child = spawn(
          process.execPath,
          [
            "--import",
            "tsx",
            "--input-type=module",
            "-e",
            `Date.now=()=>${instant}; const imported=await import(${JSON.stringify(moduleURL)}); const store=imported.default??imported; ${script}`,
          ],
          {
            cwd: process.cwd(),
            env: { ...process.env, DATABASE_PATH: process.env.DATABASE_PATH },
          },
        );
        let stdout = "",
          stderr = "";
        child.stdout.on("data", (chunk) => {
          stdout += chunk;
        });
        child.stderr.on("data", (chunk) => {
          stderr += chunk;
        });
        child.on("error", reject);
        child.on("close", (code) =>
          code === 0
            ? resolve(stdout)
            : reject(new Error(`Child exited ${code}: ${stderr}`)),
        );
        return promise;
      }
      const results = await Promise.all(
        Array.from({ length: 3 }, () =>
          processJob(
            `for(let i=0;i<20;i++) store.logProgress(${JSON.stringify(a.user.id)},{taskId:${JSON.stringify(task.id)},date:"2026-03-02",operation:"add",value:1}); console.log(store.getSession(${JSON.stringify(a.token)}).id);`,
          ),
        ),
      );
      assert.ok(results.every((result) => result.trim() === a.user.id));
      assert.equal(store.getDashboard(a.user.id).tasks[0].value, 60);
      const persisted = await processJob(
        `console.log(JSON.stringify(store.getDashboard(${JSON.stringify(a.user.id)}).tasks[0]));`,
      );
      assert.equal(JSON.parse(persisted).value, 60);
      const timer = create(a.user.id, {
        title: "Persisted timer",
        type: "duration",
        target: 60,
        unit: "seconds",
      });
      store.timerAction(a.user.id, { taskId: timer.id, action: "start" });
      const resumed = await processJob(
        `console.log(JSON.stringify(store.getDashboard(${JSON.stringify(a.user.id)}).timer));`,
      );
      assert.equal(JSON.parse(resumed).taskId, timer.id);
      store.timerAction(a.user.id, { taskId: timer.id, action: "pause" });
    },
  );
});
