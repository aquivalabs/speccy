// Harness-neutral loader for workflow.js.
//
// workflow.js is neither a plain module nor a plain function. It combines a
// top-level `export const meta = {…}` (legal only at module top level) with
// top-level `return` statements (legal only inside a function body). No single
// wrapper accepts both, so the Workflow tool — and this loader — must extract
// `meta` first, then wrap the remaining body as a function.
//
// This loader reproduces that transform for any harness:
//   1. extract and evaluate the `export const meta = {…}` object literal;
//   2. strip the `export` keyword, leaving `const meta = {…}` as an ordinary
//      statement in the body;
//   3. wrap the whole (now export-free) body in
//        async function ({ agent, parallel, phase, log, args }) { … }
//      and call it with the ambients a harness supplies.
//
// It binds only the five ambients workflow.js actually uses. The Workflow tool
// injects three more (pipeline, budget, a nested workflow()); workflow.js and
// workflow-simple.js reference none of them, so they are out of scope.
//
// INFERENCE, not read from a tool doc. The transform above is derived from JS
// module semantics: `export const meta` at workflow.js:12 pins module-top-level
// placement, and the top-level `return`s at lines 410/694 pin function-body
// placement. The shape is forced, but it is unconfirmed against the real
// Workflow tool. Validate it empirically against that tool before relying on it
// in production (plan Order-of-operations step 4). Residual risk: the tool could
// perform an additional normalisation this loader omits (e.g. a different `meta`
// evaluation sandbox). The known ambient surface is pinned by the unit tests.

const AMBIENTS = ["agent", "parallel", "phase", "log", "args"];

// End index (exclusive) of the {…} whose opening brace is at `open`.
// Tracks quotes, template literals, and comments so a brace inside a string or
// comment never miscounts. Throws if unbalanced.
function matchBrace(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      i = src.indexOf("\n", i);
      if (i === -1) break;
      continue;
    }
    if (c === "/" && next === "*") {
      i = src.indexOf("*/", i + 2) + 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(src, i, c);
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  throw new Error("workflow source: unbalanced braces in meta literal");
}

// Index of the closing quote matching the opener at `start` (quote char `q`).
// Handles escapes, and ${…} interpolation inside template literals.
function skipString(src, start, q) {
  for (let i = start + 1; i < src.length; i++) {
    const c = src[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (q === "`" && c === "$" && src[i + 1] === "{") {
      i = matchBrace(src, i + 1) - 1;
      continue;
    }
    if (c === q) return i;
  }
  throw new Error("workflow source: unterminated string in meta literal");
}

// Extract and evaluate the `export const meta = {…}` literal.
export function extractMeta(source) {
  const m = /export\s+const\s+meta\s*=\s*/.exec(source);
  if (!m) throw new Error("workflow source: no `export const meta` found");
  const open = source.indexOf("{", m.index + m[0].length);
  if (open === -1) throw new Error("workflow source: meta is not an object literal");
  const end = matchBrace(source, open);
  const literal = source.slice(open, end);
  // meta must be a pure literal; evaluate it in isolation.
  return new Function(`return (${literal});`)();
}

// Strip the single top-level `export` on `const meta`, leaving a valid body.
export function stripExport(source) {
  return source.replace(/export\s+const\s+meta\b/, "const meta");
}

// Build the async factory from the export-free body. Its one parameter is the
// destructured ambient bag, so the body's free names resolve to the harness's.
export function buildFactory(source) {
  const body = stripExport(source);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  return new AsyncFunction(`{ ${AMBIENTS.join(", ")} }`, body);
}

// The full transform: { meta, run }. `run(ambients)` executes the body with the
// supplied ambients and resolves to workflow.js's return value.
export function loadWorkflow(source) {
  const meta = extractMeta(source);
  const factory = buildFactory(source);
  return {
    meta,
    run(ambients) {
      for (const name of AMBIENTS) {
        if (!(name in ambients))
          throw new Error(`loader: missing ambient "${name}"`);
      }
      return factory(ambients);
    }
  };
}

export { AMBIENTS };
