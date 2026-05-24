import React, { type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

export function noop() {
  return undefined;
}

export function renderMarkup(element: ReactElement) {
  return renderToStaticMarkup(element);
}

export function renderWithText(element: ReactElement, expectedText: string) {
  const markup = renderMarkup(element);
  if (!markup.includes(expectedText)) {
    throw new Error(`Expected rendered markup to contain ${expectedText}`);
  }
  return markup;
}

export function action(label: string) {
  return React.createElement("button", { type: "button" }, label);
}
