import { auth } from "@/auth";
import { isUserActiveById } from "@/server/authz";
import { subscribeToTaskSourceChanges } from "@/server/task-events";
import { getUserExtensionSetting } from "@/server/user-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Comment lines keep proxies (Caddy, FRP) from closing an idle stream. */
const heartbeatMs = 25_000;

/**
 * Server-sent events: one `tasks` event per task-source change in a document
 * the signed-in user owns (see `server/task-events.ts`). Clients refetch on
 * them; the payload names the document so a single-document view can ignore
 * the rest. 204 while Tasks is off, which tells EventSource not to reconnect.
 */
export async function GET(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId || !(await isUserActiveById(userId))) {
    return new Response(null, { status: 401 });
  }

  const setting = await getUserExtensionSetting({ userId, extensionId: "vault.tasks" });
  if (!setting?.enabled) {
    return new Response(null, { status: 204 });
  }

  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          cleanup();
        }
      };

      send("retry: 5000\n: connected\n\n");
      const unsubscribe = subscribeToTaskSourceChanges(userId, ({ documentId }) => {
        send(`event: tasks\ndata: ${JSON.stringify({ documentId })}\n\n`);
      });
      const heartbeat = setInterval(() => send(": ping\n\n"), heartbeatMs);

      cleanup = () => {
        cleanup = () => {};
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed by the client going away.
        }
      };
      request.signal.addEventListener("abort", () => cleanup());
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
