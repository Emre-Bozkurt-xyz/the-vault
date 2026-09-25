import { MAX_CODE_FORMAT_LENGTH } from "./languages";

export function formatCodeInWorker(source: string, language: string, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("Formatting cancelled."));
    if (source.length > MAX_CODE_FORMAT_LENGTH) return reject(new Error("This code block is too large to format."));
    const worker = new Worker(new URL("./format.worker.ts", import.meta.url), { type: "module" });
    const finish = (result: { formatted: string } | { error: string }) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      worker.terminate();
      if ("error" in result) reject(new Error(result.error));
      else resolve(result.formatted);
    };
    const abort = () => finish({ error: "Formatting cancelled." });
    const timer = setTimeout(() => finish({ error: "Formatting timed out. Try a smaller code block." }), 10_000);
    signal.addEventListener("abort", abort, { once: true });
    worker.onerror = () => finish({ error: "Could not start the formatter. Please try again." });
    worker.onmessage = (event: MessageEvent<{ formatted: string } | { error: string }>) => finish(event.data);
    worker.postMessage({ source, language });
  });
}
