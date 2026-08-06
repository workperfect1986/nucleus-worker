import { spawn } from "node:child_process";

const children = new Set();
let stopping = false;

function start(name, command, args, env = process.env) {
  const child = spawn(command, args, { env, stdio: "inherit" });
  children.add(child);

  child.on("exit", (code, signal) => {
    children.delete(child);
    if (stopping) return;

    console.error(`${name} stopped unexpectedly (code=${code ?? "none"}, signal=${signal ?? "none"})`);
    stop(code || 1);
  });

  return child;
}

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;

  for (const child of children) child.kill("SIGTERM");

  const forceTimer = setTimeout(() => {
    for (const child of children) child.kill("SIGKILL");
    process.exit(exitCode);
  }, 10_000);
  forceTimer.unref();

  if (children.size === 0) process.exit(exitCode);
  Promise.all(Array.from(children, (child) => new Promise((resolve) => child.once("exit", resolve))))
    .finally(() => process.exit(exitCode));
}

const workerPort = process.env.NUCLEUS_WORKER_PORT || "8787";
start("nucleus-worker", process.execPath, ["services/nucleus-worker/index.mjs"], {
  ...process.env,
  PORT: workerPort,
});

start(
  "dashboard",
  process.execPath,
  ["node_modules/vinext/dist/cli.js", "start", "--host", "0.0.0.0"],
  process.env,
);

process.on("SIGTERM", () => stop(0));
process.on("SIGINT", () => stop(0));
