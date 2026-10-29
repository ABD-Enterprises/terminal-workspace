import { describe, expect, it } from "vitest";
import { createRunbookRecord } from "./runbook";

describe("#454 createRunbookRecord", () => {
  it("#454: trims fields, splits step lines, and stamps timestamps", () => {
    const record = createRunbookRecord({
      name: "  Nightly  ",
      description: "  checks  ",
      steps: "uptime\ndf -h\n\n",
    });

    expect(record.id).toBeTruthy();
    expect(record.name).toBe("Nightly");
    expect(record.description).toBe("checks");
    expect(record.steps).toEqual(["uptime", "df -h"]);
    expect(record.nextStepIndex).toBe(0);
    expect(record.createdAt).toBe(record.updatedAt);
  });

  it("#454: keeps id and createdAt on update and clamps the cursor", () => {
    const first = createRunbookRecord({ name: "A", steps: "one" });
    const updated = createRunbookRecord(
      { name: "B", steps: "one\ntwo" },
      { ...first, nextStepIndex: 9 }
    );

    expect(updated.id).toBe(first.id);
    expect(updated.createdAt).toBe(first.createdAt);
    expect(updated.nextStepIndex).toBeLessThanOrEqual(updated.steps.length);
  });
});
