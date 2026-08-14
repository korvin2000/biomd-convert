/**
 * The hook catalogue — the escalation vocabulary, by compiler stage.
 *
 * This file was the catalogue. It is now the door to one: the definitions moved
 * into `hooks/` when the set outgrew a single module, and the import path stayed
 * where it was so nothing above had to learn about the move.
 *
 * Read `hooks/catalogue.ts` for the list and, more usefully, for the abstention
 * each entry fills. Every hook in it obeys the same rule and the catalogue test
 * enforces it: **a hook is consulted only where a deterministic rule has already
 * run and declined**, its reply is checked against the same evidence that rule
 * had, and a check that fails leaves the rule's answer standing.
 */
export * from "./hooks/shared.js";
export * from "./hooks/table.js";
export * from "./hooks/text.js";
export * from "./hooks/media.js";
export * from "./hooks/document.js";
export * from "./hooks/catalogue.js";
