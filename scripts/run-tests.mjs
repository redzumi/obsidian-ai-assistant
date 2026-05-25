import esbuild from "esbuild";
import { mkdir, readdir, rm } from "fs/promises";
import { join } from "path";
import { builtinModules } from "module";
import { spawn } from "child_process";

const outdir = ".test-build";
const srcDir = "src";

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

const entryPoints = await findTestFiles(srcDir);
if (entryPoints.length === 0) {
  console.log("No test files found.");
  process.exit(0);
}

await esbuild.build({
  entryPoints,
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  outdir,
  external: [...builtinModules, ...builtinModules.map((moduleName) => `node:${moduleName}`)],
  logLevel: "silent",
});

const testFiles = await findBuiltTestFiles(outdir);
await runNodeTests(testFiles);

async function findTestFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        return findTestFiles(path);
      }
      return entry.isFile() && entry.name.endsWith(".test.ts") ? [path] : [];
    }),
  );
  return files.flat().sort();
}

async function findBuiltTestFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        return findBuiltTestFiles(path);
      }
      return entry.isFile() && entry.name.endsWith(".test.js") ? [path] : [];
    }),
  );
  return files.flat().sort();
}

function runNodeTests(testFiles) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--test", ...testFiles], { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Tests failed with exit code ${code ?? "unknown"}.`));
    });
  });
}
