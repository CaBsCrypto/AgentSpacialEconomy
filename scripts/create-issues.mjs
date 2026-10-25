#!/usr/bin/env node
// Creates the SPEC tasks as GitHub issues from docs/issues.json.
// Needs the GitHub CLI logged in (`gh auth status`). Run from the repo root:
//   node scripts/create-issues.mjs            # dry run, prints what it would create
//   node scripts/create-issues.mjs --create   # creates labels and issues
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const issues = JSON.parse(readFileSync(new URL("../docs/issues.json", import.meta.url), "utf8"));
const create = process.argv.includes("--create");

const labelColors = {
  P0: "b60205", P1: "fbca04", P2: "c5def5",
  payments: "72e3df", venue: "17485b", dashboard: "498095", deploy: "0e3146",
  story: "e3bd79", design: "e3bd79", agent: "72e3df", tests: "90a8bb", setup: "90a8bb",
};

const gh = (args) => execFileSync("gh", args, { stdio: ["ignore", "pipe", "inherit"] }).toString().trim();

if (create) {
  for (const [name, color] of Object.entries(labelColors)) {
    gh(["label", "create", name, "--color", color, "--force"]);
  }
}

for (const [i, issue] of issues.entries()) {
  const args = ["issue", "create", "--title", issue.title, "--body", issue.body];
  for (const l of issue.labels) args.push("--label", l);
  if (create) {
    console.log(gh(args));
  } else {
    console.log(`#${i + 1} [${issue.labels.join(", ")}] ${issue.title}`);
  }
}
if (!create) console.log("\nDry run. Add --create to create labels and issues.");
