// Shared "read a file, return null if it can't be read" helper for
// adapters/codex/. state.mjs's readIfFile is the core equivalent, but the
// adapter/core boundary means this package keeps its own copy rather than
// importing across it.

import fs from "node:fs";

export function readIfPresent(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}
