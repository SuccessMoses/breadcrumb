// A script runs in a Web Worker, which is stopped after this long
const TIME_LIMIT_MS = 2000;

// What a run wrote to stdout, and the error that stopped it, if one did
type ScriptRun = { lines: string[]; error: string | undefined };

// The worker runs the script as the body of a function that takes input and
// console. Its console.log writes a line, and the lines come back when it ends.
const WORKER = `
self.onmessage = (event) => {
  const lines = [];
  const print = (...values) => {
    lines.push(values.map((value) => String(value)).join(" "));
  };
  const sandboxConsole = { log: print, info: print, warn: print, error: print };
  try {
    new Function("input", "console", event.data.code)(event.data.input, sandboxConsole);
    self.postMessage({ lines, error: undefined });
  } catch (error) {
    self.postMessage({ lines, error: String(error) });
  }
};
`;

// Runs the code over the input and resolves to what it wrote

export const runScript = (code: string, input: string): Promise<ScriptRun> =>
  // eslint-disable-next-line compat/compat -- the run waits for the worker
  new Promise((resolve) => {
    // eslint-disable-next-line compat/compat -- the worker is loaded from a blob URL
    const url = URL.createObjectURL(
      new Blob([WORKER], { type: "text/javascript" }),
    );
    const worker = new Worker(url);
    const finish = (run: ScriptRun) => {
      window.clearTimeout(timer);
      worker.terminate();
      // eslint-disable-next-line compat/compat -- the blob URL is released after the run
      URL.revokeObjectURL(url);
      resolve(run);
    };
    const timer = window.setTimeout(
      () => finish({ lines: [], error: "Timed out after 2 seconds" }),
      TIME_LIMIT_MS,
    );
    worker.onmessage = (event: MessageEvent<ScriptRun>) => finish(event.data);
    worker.onerror = (event) => finish({ lines: [], error: event.message });
    worker.postMessage({ code, input });
  });
