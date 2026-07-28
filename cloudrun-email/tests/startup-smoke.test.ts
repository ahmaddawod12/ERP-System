import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import test from "node:test";

import { terraformProductionEnv } from "./fixtures/terraform-production-env.js";

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address === "object");
  const { port } = address;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  return port;
}

test("compiled email process starts with Terraform-shaped production configuration", async (t) => {
  const port = await reservePort();
  const child = spawn(process.execPath, ["dist/src/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...terraformProductionEnv,
      HOST: "127.0.0.1",
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => {
    if (!child.killed) child.kill("SIGTERM");
  });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  await Promise.race([
    new Promise<void>((resolve, reject) => {
      const inspectOutput = () => {
        if (stdout.includes("Server listening at")) resolve();
      };
      child.stdout.on("data", inspectOutput);
      child.once("exit", (code, signal) => {
        reject(new Error(
          `email process exited before listening (code=${code}, signal=${signal})\n${stdout}\n${stderr}`,
        ));
      });
      child.once("error", reject);
    }),
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error(`email startup timed out\n${stdout}\n${stderr}`)), 5_000);
    }),
  ]);
});
