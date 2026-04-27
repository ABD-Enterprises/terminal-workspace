// In-pane search-in-scrollback helpers. Extracted from TerminalPane so the
// match-scanning logic can be unit-tested without rendering an xterm.
//
// We do not depend on @xterm/addon-search because it is not in the local
// pnpm offline cache and adding it would require network. The renderer
// drives xterm's own buffer + selection APIs directly. See
// docs/parity-and-hardening-plan.md P1-UX6.

/** Subset of xterm's IBufferLine that we actually need for searching. */
export interface SearchableBufferLine {
  translateToString: (trimRight?: boolean) => string;
}

/** Subset of xterm's IBuffer / Terminal#buffer.active that we actually need. */
export interface SearchableBuffer {
  readonly length: number;
  getLine: (y: number) => SearchableBufferLine | undefined;
}

export interface SearchMatch {
  /** Absolute row index into the buffer (includes scrollback). */
  row: number;
  /** Zero-based column where the match starts on `row`. */
  col: number;
  /** Match length in columns; xterm's select() handles wraps across lines. */
  length: number;
}

/**
 * Scan the entire scrollback buffer for occurrences of `query`. Matches are
 * returned in document order so navigation is just `index + 1` / `index - 1`.
 * Empty queries return `[]` — the search overlay treats that as "no
 * highlighting", not as "match everything".
 */
export function findMatchesInBuffer(
  buffer: SearchableBuffer,
  query: string,
  caseSensitive: boolean
): SearchMatch[] {
  if (!query) {
    return [];
  }
  const total = buffer.length;
  const needle = caseSensitive ? query : query.toLowerCase();
  const matches: SearchMatch[] = [];
  for (let row = 0; row < total; row += 1) {
    const line = buffer.getLine(row);
    if (!line) {
      continue;
    }
    // `translateToString(true)` trims trailing whitespace, which keeps match
    // columns stable for users — finding "abc" in a line of "abc   " should
    // be at column 0 regardless of the line's filled width.
    const text = line.translateToString(true);
    const haystack = caseSensitive ? text : text.toLowerCase();
    let from = 0;
    while (from <= haystack.length) {
      const index = haystack.indexOf(needle, from);
      if (index === -1) {
        break;
      }
      matches.push({ row, col: index, length: query.length });
      // Advance past this match, but never less than 1 char to avoid an
      // infinite loop on a zero-length needle (already filtered above, but
      // belt-and-suspenders for any future caller).
      from = index + Math.max(needle.length, 1);
    }
  }
  return matches;
}
