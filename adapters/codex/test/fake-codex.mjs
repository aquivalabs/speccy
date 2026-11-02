// A fake `codex exec`. The runtime spawns it exactly as it would the real codex
// (codexBin=node, codexArgsPrefix=[this file]), so it exercises the real spawn,
// -C, and -o argument shapes, and the real prompt-carried result path — no
// tokens, no code-mode host.
//
// Behaviour is driven by a marker the test puts in its own prompt:
//   [[FAKE:ok]]        (default) write a schema-valid STEP_SCHEMA result
//   [[FAKE:malformed]] write non-JSON to the result path
//   [[FAKE:wrongschema]] write valid JSON that violates STEP_SCHEMA
//   [[FAKE:absent]]    write no result file at all
//   [[FAKE:fail]]      write the -o last-message file, then exit 1 (simulates
//                      a crashed/denied `codex exec` that still left stale
//                      output behind)
//   [[FAKE:commit:<hash>]] write { success: true, commit: <hash> } — for
//                      driving the crossCheckCommit wiring inside agent()

import fs from "node:fs";

const argv = process.argv.slice(2);
const oIdx = argv.indexOf("-o");
const lastMsgPath = oIdx >= 0 ? argv[oIdx + 1] : null;
const prompt = argv[argv.length - 1] || "";

if (lastMsgPath) fs.writeFileSync(lastMsgPath, "fake codex done\n");

const resultMatch = /(\/\S+\.result\.json)/.exec(prompt);
const commitMatch = /\[\[FAKE:commit:([0-9a-fA-F]+)\]\]/.exec(prompt);
if (resultMatch && commitMatch) {
  fs.writeFileSync(resultMatch[1], JSON.stringify({ success: true, commit: commitMatch[1] }));
} else if (resultMatch) {
  const resultPath = resultMatch[1];
  const mode = (/\[\[FAKE:(\w+)\]\]/.exec(prompt) || [, "ok"])[1];
  if (mode === "malformed") {
    fs.writeFileSync(resultPath, "not json {{{");
  } else if (mode === "wrongschema") {
    fs.writeFileSync(resultPath, JSON.stringify({ steps: "not an array" }));
  } else if (mode === "absent") {
    // write nothing
  } else {
    fs.writeFileSync(
      resultPath,
      JSON.stringify({
        steps: [
          {
            parallel: false,
            tasks: [
              {
                id: "task-1",
                title: "Fake task",
                description: "Do the thing",
                files: [],
                acceptance_criteria: ["it is done"]
              }
            ]
          }
        ]
      })
    );
  }
}

const mode = (/\[\[FAKE:(\w+)\]\]/.exec(prompt) || [, "ok"])[1];
process.exit(mode === "fail" ? 1 : 0);
