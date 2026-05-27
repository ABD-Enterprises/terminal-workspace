import { vi, expect, it } from "vitest";

// Stub document for parameter evaluation in main.tsx
const g = globalThis as unknown as Record<string, unknown>;
g.document = {
  getElementById: () => ({}),
};

vi.mock("react-dom/client", () => ({
  default: {
    createRoot: () => ({
      render: () => {},
    }),
  },
  createRoot: () => ({
    render: () => {},
  }),
}));

it("imports successfully", async () => {
  const mod = await import("./main");
  expect(mod).toBeDefined();
});
