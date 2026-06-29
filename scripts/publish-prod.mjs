import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const gitDir = existsSync(".git-cursos") ? ".git-cursos" : ".git";
const commitMessage = process.argv.slice(2).join(" ").trim()
  || `update project ${new Date().toISOString().slice(0, 10)}`;

function run(command, args, options = {}) {
  console.log(`\n> ${[command, ...args].join(" ")}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    ...options
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function output(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8"
  });

  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status || 1);
  }

  return result.stdout.trim();
}

function git(args, options) {
  return run("git", [`--git-dir=${gitDir}`, "--work-tree=.", ...args], options);
}

function gitOutput(args) {
  return output("git", [`--git-dir=${gitDir}`, "--work-tree=.", ...args]);
}

const branch = gitOutput(["branch", "--show-current"]) || "main";
const shortStatus = gitOutput(["status", "--short"]);

if (shortStatus) {
  git(["add", "-A"]);
  git(["commit", "-m", commitMessage]);
} else {
  console.log("\nGit sem alteracoes novas para commitar.");
}

git(["push", "-u", "origin", branch]);

run("npx.cmd", ["vercel", "--prod", "--yes", "--scope", "joaos-projects-b385729c"]);

console.log("\nPublicado no GitHub e na Vercel.");
