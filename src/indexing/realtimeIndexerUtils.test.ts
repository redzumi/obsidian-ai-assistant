import { equal } from "node:assert/strict";
import { test } from "node:test";
import { scheduledPathMatchesTarget } from "./realtimeIndexerUtils";

test("scheduledPathMatchesTarget matches exact files and folder descendants only", () => {
  equal(scheduledPathMatchesTarget("Projects/A.md", "Projects/A.md"), true);
  equal(scheduledPathMatchesTarget("Projects/A.md", "Projects"), true);
  equal(scheduledPathMatchesTarget("Projects/Nested/A.md", "Projects/"), true);
  equal(scheduledPathMatchesTarget("Projects-Archive/A.md", "Projects"), false);
  equal(scheduledPathMatchesTarget("Other/Projects/A.md", "Projects"), false);
});
