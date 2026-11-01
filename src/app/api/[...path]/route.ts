import { NextRequest } from "next/server";
import * as store from "@/server/store";
import { notify } from "@/server/events";
import { clientKey, rateLimit } from "@/server/rate-limit";
import type {
  Credentials,
  MembershipInput,
  ProgressInput,
  Registration,
  TaskInput,
  TimerInput,
} from "@/shared/types";
import {
  fail,
  json,
  readBody,
  requireUser,
  tokenFrom,
  withSession,
  withoutSession,
} from "../_http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path: string[] }> };

function enforceRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  message: string,
) {
  const result = rateLimit(key, limit, windowMs);
  if (result.allowed) return;
  const wait =
    result.retryAfter >= 60
      ? `${Math.ceil(result.retryAfter / 60)} minute${result.retryAfter >= 120 ? "s" : ""}`
      : `${result.retryAfter} second${result.retryAfter === 1 ? "" : "s"}`;
  throw new store.AppError(
    429,
    `${message} Try again in ${wait}.`,
    undefined,
    result.retryAfter,
  );
}

function rangeOf(request: NextRequest): "week" | "month" {
  const range = request.nextUrl.searchParams.get("range") ?? "week";
  if (range !== "week" && range !== "month")
    throw new store.AppError(400, "Choose a week or month range.", "range");
  return range;
}
function field(body: Record<string, unknown>, name: string): string {
  if (typeof body[name] !== "string")
    throw new store.AppError(400, `Provide ${name}.`, name);
  return body[name] as string;
}

export async function GET(request: NextRequest, context: Context) {
  try {
    const { path } = await context.params;
    const route = path.join("/");
    if (route === "session")
      return json({ user: store.getSession(tokenFrom(request)) });
    if (path[0] === "invites" && path.length === 2) {
      enforceRateLimit(
        `invite-preview:${clientKey(request)}`,
        120,
        60_000,
        "Too many invitation checks.",
      );
      return json(store.previewInvite(path[1]));
    }
    const user = requireUser(request);
    if (route === "dashboard")
      return json(
        store.getDashboard(
          user.id,
          request.nextUrl.searchParams.get("date") ?? undefined,
        ),
      );
    if (route === "progress")
      return json(
        store.getProgress(user.id, {
          range: rangeOf(request),
          anchor: request.nextUrl.searchParams.get("anchor") ?? undefined,
          taskId: request.nextUrl.searchParams.get("taskId") ?? undefined,
        }),
      );
    if (route === "parties")
      return json({ parties: store.listParties(user.id) });
    if (path[0] === "parties" && path.length === 2)
      return json(store.getParty(user.id, path[1]));
    if (
      path[0] === "parties" &&
      path[2] === "members" &&
      path[4] === "history" &&
      path.length === 5
    ) {
      return json(
        store.getMemberHistory(user.id, path[1], path[3], {
          range: rangeOf(request),
          anchor: request.nextUrl.searchParams.get("anchor") ?? undefined,
        }),
      );
    }
    throw new store.AppError(404, "This page could not be found.");
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const { path } = await context.params;
    const route = path.join("/");
    const body = await readBody(request);
    if (route === "auth/register" || route === "auth/login") {
      const address = clientKey(request);
      if (route === "auth/register") {
        enforceRateLimit(
          "register:global",
          30,
          60 * 60_000,
          "Too many account creation attempts.",
        );
        enforceRateLimit(
          `register:${address}`,
          10,
          60 * 60_000,
          "Too many account creation attempts.",
        );
      } else {
        enforceRateLimit(
          "login:global",
          600,
          15 * 60_000,
          "Too many sign-in attempts.",
        );
        enforceRateLimit(
          `login:${address}`,
          30,
          15 * 60_000,
          "Too many sign-in attempts.",
        );
        if (typeof body.email === "string")
          enforceRateLimit(
            `login-account:${body.email.trim().toLowerCase().slice(0, 254)}`,
            10,
            15 * 60_000,
            "Too many sign-in attempts for this account.",
          );
      }
      const result =
        route === "auth/register"
          ? await store.register(body as unknown as Registration)
          : await store.login(body as unknown as Credentials);
      return withSession(json({ user: result.user }), result.token, request);
    }
    if (route === "auth/logout") {
      const previous = store.getSession(tokenFrom(request));
      store.logout(tokenFrom(request));
      if (previous) notify([previous.id]);
      return withoutSession(json({ ok: true }), request);
    }
    const user = requireUser(request);
    if (path[0] === "invites" && path[2] === "join")
      enforceRateLimit(
        `join:${user.id}`,
        30,
        60 * 60_000,
        "Too many invitation attempts.",
      );
    const isTaskMutation =
      route === "tasks/save" ||
      route === "tasks/archive" ||
      route === "progress/log" ||
      route === "timer";
    const taskId =
      typeof body.taskId === "string"
        ? body.taskId
        : typeof body.id === "string"
          ? body.id
          : undefined;
    const sharedBefore =
      isTaskMutation && taskId
        ? store.isTaskShared(
            user.id,
            taskId,
            typeof body.date === "string" ? body.date : undefined,
          )
        : false;
    const affectsParty =
      !isTaskMutation ||
      sharedBefore ||
      (route === "tasks/save" && typeof body.partyId === "string");
    const before = affectsParty ? store.getAudience(user.id) : [user.id];
    let result: unknown = { ok: true };
    if (route === "profile") {
      result = {
        user: store.updateProfile(user.id, {
          name: field(body, "name"),
          timezone: field(body, "timezone"),
        }),
      };
    } else if (route === "tasks/save") {
      store.saveTask(user.id, body as unknown as TaskInput);
    } else if (route === "tasks/archive") {
      store.archiveTask(user.id, field(body, "id"));
    } else if (route === "tasks/reorder") {
      store.reorderTasks(user.id, body.ids as string[]);
    } else if (route === "progress/log") {
      store.logProgress(user.id, body as unknown as ProgressInput);
    } else if (route === "timer") {
      store.timerAction(user.id, body as unknown as TimerInput);
    } else if (route === "parties") {
      result = {
        party: store.createParty(user.id, {
          name: field(body, "name"),
          description:
            typeof body.description === "string" ? body.description : "",
        }),
      };
    } else if (
      path[0] === "parties" &&
      path[2] === "settings" &&
      path.length === 3
    ) {
      store.updateParty(user.id, path[1], {
        name: field(body, "name"),
        description:
          typeof body.description === "string" ? body.description : "",
      });
    } else if (
      path[0] === "parties" &&
      path[2] === "invites" &&
      path.length === 3
    ) {
      result = store.createInvite(user.id, path[1]);
    } else if (
      path[0] === "parties" &&
      path[2] === "invites" &&
      path[4] === "revoke" &&
      path.length === 5
    ) {
      store.revokeInvite(user.id, path[1], path[3]);
    } else if (
      path[0] === "parties" &&
      path[2] === "members" &&
      path.length === 3
    ) {
      store.manageMembership(
        user.id,
        path[1],
        body as unknown as MembershipInput,
      );
    } else if (
      path[0] === "invites" &&
      path[2] === "join" &&
      path.length === 3
    ) {
      result = store.joinParty(user.id, path[1]);
    } else {
      throw new store.AppError(404, "This action could not be found.");
    }
    const sharedAfter =
      isTaskMutation && taskId
        ? store.isTaskShared(
            user.id,
            taskId,
            typeof body.date === "string" ? body.date : undefined,
          )
        : false;
    const after =
      affectsParty || sharedAfter ? store.getAudience(user.id) : [user.id];
    notify([...before, ...after]);
    return json(result);
  } catch (error) {
    return fail(error);
  }
}
