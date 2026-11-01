import { NextRequest } from "next/server";
import { AppError, getSession } from "@/server/store";
import {
  acquireConnection,
  releaseConnection,
  subscribe,
} from "@/server/events";
import { fail, requireUser, tokenFrom } from "../_http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = requireUser(request);
    if (!acquireConnection(user.id))
      throw new AppError(
        429,
        "Too many live connections. Close another tab and try again.",
        undefined,
        30,
      );
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      releaseConnection(user.id);
    };
    const token = tokenFrom(request);
    const encoder = new TextEncoder();
    let stop = () => {};
    try {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          let closed = false;
          let unsubscribe = () => {};
          let heartbeat: NodeJS.Timeout | undefined;
          stop = () => {
            if (closed) return;
            closed = true;
            unsubscribe();
            clearInterval(heartbeat);
            request.signal.removeEventListener("abort", stop);
            release();
            try {
              controller.close();
            } catch {
              /* Already closed by the browser. */
            }
          };
          const send = (message: string) => {
            if (closed) return;
            try {
              controller.enqueue(encoder.encode(message));
            } catch {
              stop();
            }
          };
          unsubscribe = subscribe(user.id, () =>
            send("event: refresh\ndata: {}\n\n"),
          );
          heartbeat = setInterval(() => {
            try {
              if (!getSession(token)) return stop();
              send(": keepalive\n\n");
            } catch {
              stop();
            }
          }, 15000);
          request.signal.addEventListener("abort", stop, { once: true });
          if (request.signal.aborted) stop();
          else send(": connected\n\n");
        },
        cancel() {
          stop();
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    } catch (error) {
      stop();
      release();
      throw error;
    }
  } catch (error) {
    return fail(error);
  }
}
