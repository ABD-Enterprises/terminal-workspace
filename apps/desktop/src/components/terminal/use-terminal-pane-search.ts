import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { type Terminal } from "xterm";
import { findMatchesInBuffer, type SearchMatch } from "../../lib/terminal-search";

export function nextSearchIndex(current: number, direction: 1 | -1, matchCount: number) {
  if (matchCount === 0) {
    return 0;
  }
  return (current + direction + matchCount) % matchCount;
}

interface UseTerminalPaneSearchOptions {
  terminalRef: MutableRefObject<Terminal | null>;
}

export interface TerminalPaneSearchState {
  advanceSearchMatch: (direction: 1 | -1) => void;
  closeSearch: () => void;
  searchActiveIndex: number;
  searchCaseSensitive: boolean;
  searchInputRef: MutableRefObject<HTMLInputElement | null>;
  searchMatches: SearchMatch[];
  searchOpen: boolean;
  searchQuery: string;
  setSearchCaseSensitive: Dispatch<SetStateAction<boolean>>;
  setSearchOpen: Dispatch<SetStateAction<boolean>>;
  setSearchQuery: Dispatch<SetStateAction<string>>;
}

export function useTerminalPaneSearch({ terminalRef }: UseTerminalPaneSearchOptions): TerminalPaneSearchState {
  // ---- In-pane search-in-scrollback (Cmd+F) ------------------------------
  // We do not depend on @xterm/addon-search here because it is not in the
  // local pnpm offline cache and adding it would require network. Instead
  // we drive xterm's own buffer + selection APIs directly. See
  // parity-and-hardening-plan.md P1-UX6.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchCaseSensitive, setSearchCaseSensitive] = useState(false);
  const [searchMatches, setSearchMatches] = useState<SearchMatch[]>([]);
  const [searchActiveIndex, setSearchActiveIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // ---- Search effects ----------------------------------------------------
  // Recompute matches when the query or case sensitivity changes, and reset
  // the active index so the highlight starts at the first match. Empty
  // query -> no matches (clearSelection runs in the navigation effect).
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal || !searchOpen) {
      return;
    }
    const matches = findMatchesInBuffer(
      terminal.buffer.active,
      searchQuery,
      searchCaseSensitive
    );
    setSearchMatches(matches);
    setSearchActiveIndex(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- dependency array preserved verbatim from useTerminalPaneSession.
  }, [searchOpen, searchQuery, searchCaseSensitive]);

  // Move the viewport + selection to the active match. clearSelection on an
  // empty match list keeps stale highlighting from previous queries from
  // sticking around.
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal || !searchOpen) {
      return;
    }
    if (searchMatches.length === 0) {
      terminal.clearSelection();
      return;
    }
    const safeIndex = Math.min(Math.max(0, searchActiveIndex), searchMatches.length - 1);
    const match = searchMatches[safeIndex];
    // scrollToLine wants a row index relative to the buffer's baseY; if the
    // match is in scrollback above baseY, the same row index brings it on-
    // screen because the viewport is positioned by row.
    terminal.scrollToLine(match.row);
    terminal.select(match.col, match.row, match.length);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- dependency array preserved verbatim from useTerminalPaneSession.
  }, [searchActiveIndex, searchMatches, searchOpen]);

  // Focus the search input as soon as the overlay opens.
  useEffect(() => {
    if (searchOpen) {
      // Defer to next frame so the input is in the DOM before .focus().
      const id = window.requestAnimationFrame(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      });
      return () => window.cancelAnimationFrame(id);
    }
    // Closing -> clean up any leftover selection so it does not bleed into
    // a non-search interaction.
    terminalRef.current?.clearSelection();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- dependency array preserved verbatim from useTerminalPaneSession.
  }, [searchOpen]);

  const advanceSearchMatch = (direction: 1 | -1) => {
    setSearchActiveIndex((current) => nextSearchIndex(current, direction, searchMatches.length));
  };

  const closeSearch = () => {
    setSearchOpen(false);
    setSearchQuery("");
    setSearchMatches([]);
    setSearchActiveIndex(0);
  };

  return {
    advanceSearchMatch,
    closeSearch,
    searchActiveIndex,
    searchCaseSensitive,
    searchInputRef,
    searchMatches,
    searchOpen,
    searchQuery,
    setSearchCaseSensitive,
    setSearchOpen,
    setSearchQuery,
  };
}
