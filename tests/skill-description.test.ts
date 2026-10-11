import { expect, it } from "vitest";
import { skillDescription } from "@/lib/skillWriter";

it.each([
  ['description: "Review: changes"', "Review: changes"],
  [
    "description: >-\n  Review changes\n  and suggest fixes",
    "Review changes and suggest fixes",
  ],
  [
    "description: |\n  Review changes\n  Suggest fixes",
    "Review changes\nSuggest fixes",
  ],
  ["description: 123", ""],
  ["description: [invalid", ""],
  ["name: review", ""],
  ["description: &x [*x]", ""],
])(
  "reads YAML descriptions without treating other types as text: %s",
  (yaml, expected) => {
    expect(skillDescription(`---\n${yaml}\n---\nBody`)).toBe(expected);
  },
);

it("handles CRLF and ignores text outside frontmatter", () => {
  expect(
    skillDescription('\uFEFF---\r\ndescription: "Review"\r\n---\r\nBody'),
  ).toBe("Review");
  expect(skillDescription("# Title\n---\ndescription: Body\n---")).toBe("");
  expect(skillDescription("---\ndescription: Incomplete")).toBe("");
});
