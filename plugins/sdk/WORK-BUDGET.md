# workBudget contract (#45)

- **Shape** (required integer fields ≥ 0): `plugins/sdk/manifest-work-budget.schema.json`
- **Host ceilings** (install root only): `service/policy/work-budget-ceilings.json`
- **Catalog load**: clamp to ceilings; set `workBudgetLimited` to the shared note in `plugins/sdk/work-budget-limited-note.json`
- **Install/update**: block only when any field exceeds **10×** host ceiling
- **Packs**: receive clamped caps via sandbox init `workBudget` (see `plugins/sdk/host-init-context.ts`); never read policy from inside the zip
