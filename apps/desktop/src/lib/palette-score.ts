// Fuzzy match scorer for the command palette. T09.
//
// Termius's palette accepts acronym queries ("pg" matches "Production
// Gateway") and substring matches anywhere in the candidate. The
// previous filter was case-insensitive substring only, which made the
// palette feel sluggish for users with long host labels.
//
// Scoring buckets (higher = better; 0 = no match):
//   - 1000+  exact (case-insensitive) match
//   -  900+  acronym match (each word's first letter, in query order)
//   -  500+  prefix match (target starts with the query)
//   -  100+  substring match somewhere mid-target
//   -    1+  subsequence match (each query char appears in order)
//
// Ties within a bucket are broken by shorter target (more specific
// match wins). The function never panics on weird input — empty
// query returns 0, empty target returns 0.

export function scorePaletteMatch(query: string, target: string): number {
  const q = query.trim().toLowerCase();
  const t = target.trim().toLowerCase();
  if (q.length === 0 || t.length === 0) {
    return 0;
  }

  // Exact match — the user typed the whole label.
  if (q === t) {
    return 10_000;
  }

  // Acronym match: split target into words on whitespace + a few
  // separators we use throughout the product (-, _, /, :, .). The
  // acronym is the first letter of each word. If the query equals
  // the acronym, that's a high-confidence match.
  const acronym = t
    .split(/[\s\-_/.:]+/)
    .filter((word) => word.length > 0)
    .map((word) => word[0])
    .join("");
  if (acronym === q) {
    // Boost by target brevity so "pgw" matching "Production Gateway"
    // beats "Production Gateway with a long suffix".
    return 5_000 - Math.min(t.length, 500);
  }
  if (acronym.startsWith(q)) {
    return 4_000 - Math.min(t.length, 500);
  }

  // Prefix match — target starts with the query.
  if (t.startsWith(q)) {
    return 2_000 - Math.min(t.length, 500);
  }

  // Substring match — query appears somewhere in the target.
  if (t.includes(q)) {
    return 1_000 - Math.min(t.length, 500);
  }

  // Subsequence match — each query char appears in the target in
  // order (with arbitrary chars between).
  let queryIdx = 0;
  for (let i = 0; i < t.length && queryIdx < q.length; i += 1) {
    if (t[i] === q[queryIdx]) {
      queryIdx += 1;
    }
  }
  if (queryIdx === q.length) {
    return 100 - Math.min(t.length, 99);
  }

  return 0;
}

/**
 * Returns true if the query matches the target by any of the scoring
 * paths. Convenience wrapper for filter() callers.
 */
export function matchesPalette(query: string, target: string): boolean {
  return scorePaletteMatch(query, target) > 0;
}
