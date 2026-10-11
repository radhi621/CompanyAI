import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { env } from "../src/config/env";
import { describeOutcome, describePendingAction } from "../src/modules/agent/agent.confirmation";
import { buildFallbackAnswer } from "../src/modules/agent/agent.fallbackAnswer";

describe("buildFallbackAnswer", () => {
  it("renders lists as tables with the ID last", () => {
    const text = buildFallbackAnswer([
      {
        tool: "search_patient",
        result: {
          total: 1,
          patients: [{ _id: "6ac7f8e295fc5deac8262ee7", firstName: "Leila", lastName: "Mansouri", cin: "DEMO1005", pathologies: ["Migraine"] }],
        },
      },
    ]);

    expect(text).toContain("| First Name | Last Name | Cin | Pathologies | Id |");
    expect(text).toContain("| Leila | Mansouri | DEMO1005 | Migraine | `6ac7f8e295fc5deac8262ee7` |");
  });

  it("keeps table cells on one line and escapes pipes", () => {
    const text = buildFallbackAnswer([
      { tool: "list_patient_notes", result: { notes: [{ noteId: "n1", content: "Line one\nLine | two" }] } },
    ]);

    expect(text).toContain("| Line one Line / two | `n1` |");
  });

  it("says when a list is empty and renders single records as labelled lines", () => {
    expect(buildFallbackAnswer([{ tool: "list_patient_notes", result: { total: 0, notes: [] } }])).toContain(
      "No notes found.",
    );
    expect(
      buildFallbackAnswer([{ tool: "check_availability", result: { available: true, date: "2026-10-12T09:00:00.000Z" } }]),
    ).toContain("- **Available:** true\n- **Date:** 2026-10-12");
  });
});

describe("describePendingAction", () => {
  it("names the record each action targets, with its date (clinic time), author and text", () => {
    const noteId = "6ac7f8e295fc5deac8262eec";
    const createdAt = new Date("2026-10-08T09:30:00Z");
    // Morocco's UTC offset depends on the tz database version, so compute the expected time.
    const clinicTime = DateTime.fromJSDate(createdAt).setZone(env.APP_TIMEZONE).toFormat("yyyy-MM-dd HH:mm");
    const text = describePendingAction(
      [{ tool: "delete_patient_note", args: { noteId } }],
      [
        {
          notes: [
            { noteId, content: "Reports 3-4 migraine episodes per month.", createdBy: "Nadia Bennani", createdAt },
          ],
        },
      ],
    );

    expect(text).toContain(
      `- **Delete note**: noteId \`${noteId}\` (${clinicTime}, Nadia Bennani, "Reports 3-4 migraine episodes per month.")`,
    );
  });

  it("shows the arguments when the target is not in the results", () => {
    const text = describePendingAction([{ tool: "cancel_appointment", args: { appointmentId: "6ac7f8e295fc5deac8262eed", reason: "Patient ill" } }], []);

    expect(text).toContain("- **Cancel appointment**: appointmentId 6ac7f8e295fc5deac8262eed; reason Patient ill");
  });
});

describe("describeOutcome", () => {
  it("says what ran and gives the ID of what was created", () => {
    const text = describeOutcome(
      [{ tool: "create_patient", args: { firstName: "Nour", lastName: "Alaoui", cin: "AB12345" } }],
      [{ tool: "create_patient", args: {}, result: { _id: "6ac7f8e295fc5deac8262eee", firstName: "Nour" } }],
    );

    expect(text).toBe(
      "Done. The approved action ran:\n- **Create patient**: firstName Nour; lastName Alaoui; cin AB12345 → `6ac7f8e295fc5deac8262eee`",
    );
  });
});
