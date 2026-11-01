import { NextRequest, NextResponse } from "next/server";
import { AppError, getSession } from "@/server/store";

export const SESSION_COOKIE = "one_percent_session";
export function json(
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}
export function tokenFrom(request: NextRequest): string {
  return request.cookies.get(SESSION_COOKIE)?.value ?? "";
}
export function requireUser(request: NextRequest) {
  const user = getSession(tokenFrom(request));
  if (!user)
    throw new AppError(401, "Your session has ended. Please sign in again.");
  return user;
}
export function fail(error: unknown) {
  if (error instanceof AppError)
    return json(
      { error: error.message, ...(error.field ? { field: error.field } : {}) },
      error.status,
      error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {},
    );
  console.error("Request failed:", error);
  return json(
    { error: "Something went wrong saving your changes. Please try again." },
    500,
  );
}
export async function readBody(
  request: NextRequest,
): Promise<Record<string, unknown>> {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  let sameOrigin = false;
  try {
    sameOrigin =
      !!origin &&
      !!host &&
      new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch {
    /* Invalid origins are rejected. */
  }
  if (!sameOrigin)
    throw new AppError(
      403,
      "This request must come from the app's own website.",
    );
  if (
    request.headers.get("content-type")?.split(";")[0].trim() !==
    "application/json"
  ) {
    throw new AppError(415, "Send this request as JSON.");
  }
  if (Number(request.headers.get("content-length") ?? 0) > 32768)
    throw new AppError(413, "This request is too large.");
  let text = "";
  const reader = request.body?.getReader();
  if (reader) {
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        size += value.byteLength;
        if (size > 32768) {
          try {
            await reader.cancel();
          } catch {
            /* The client may already be gone. */
          }
          throw new AppError(413, "This request is too large.");
        }
        chunks.push(value);
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(400, "The request body could not be read.");
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* The stream is already closed. */
      }
    }
    text = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString(
      "utf8",
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new AppError(400, "The request contains invalid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AppError(400, "The request must contain a JSON object.");
  return value as Record<string, unknown>;
}
function secureCookie(request: NextRequest) {
  return (
    process.env.COOKIE_SECURE === "true" ||
    request.nextUrl.protocol === "https:" ||
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https"
  );
}
export function withSession(
  response: NextResponse,
  token: string,
  request: NextRequest,
) {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookie(request),
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
export function withoutSession(response: NextResponse, request: NextRequest) {
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookie(request),
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  });
  return response;
}
