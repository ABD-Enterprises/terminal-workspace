import type { Terminal } from "xterm";

interface PrivateViewport {
  __termsnipGuarded?: boolean;
  _coreBrowserService?: { window: Window };
  _innerRefresh?: () => void;
  _refreshAnimationFrame?: number | null;
  _renderService?: { _renderer?: { value?: unknown } };
}
export function getPrivateViewport(terminal: Terminal) {
  return (terminal as Terminal & { _core?: { viewport?: PrivateViewport } })._core?.viewport;
}

export function clearViewportRefreshFrame(viewport?: PrivateViewport) {
  if (viewport?._refreshAnimationFrame == null) return;
  viewport._coreBrowserService?.window.cancelAnimationFrame(viewport._refreshAnimationFrame);
  viewport._refreshAnimationFrame = null;
}

export function guardViewportRefresh(terminal: Terminal) {
  const viewport = getPrivateViewport(terminal);
  if (!viewport || viewport.__termsnipGuarded || typeof viewport._innerRefresh !== "function") return;
  const originalInnerRefresh = viewport._innerRefresh.bind(viewport);
  viewport._innerRefresh = () => {
    if (!viewport._renderService?._renderer?.value) {
      clearViewportRefreshFrame(viewport);
      return;
    }
    originalInnerRefresh();
  };
  viewport.__termsnipGuarded = true;
}
