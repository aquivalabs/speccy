// Harness-neutral loader for workflow.js.
//
// workflow.js is neither a plain module nor a plain function. It combines a
// top-level `export const meta = {…}` (legal only at module top level) with
// top-level `return` statements (legal only inside a function body). No single
// wrapper accepts both, so this loader strips the `export` keyword, leaving
// `const meta = {…}` as an ordinary statement, and wraps the body in
//   async function ({ agent, parallel, phase, log, args }) { … }
//
// It binds only the five ambients workflow.js actually uses. The Workflow tool
// injects three more (pipeline, budget, a nested workflow()); workflow.js and
// workflow-simple.js reference none of them.

const AMBIENTS = ["agent", "parallel", "phase", "log", "args"];

// Compiles the body, so it throws on any syntax error in the script.
// `run(ambients)` resolves to the script's return value.
export function loadWorkflow(source) {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const factory = new AsyncFunction(
    `{ ${AMBIENTS.join(", ")} }`,
    source.replace(/export\s+const\s+meta\b/, "const meta")
  );
  return {
    run(ambients) {
      for (const name of AMBIENTS) {
        if (!(name in ambients))
          throw new Error(`loader: missing ambient "${name}"`);
      }
      return factory(ambients);
    }
  };
}
