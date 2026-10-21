## Agent skills

### Issue tracker

Issues live as markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical roles, label strings equal to role names (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` at the repo root and ADRs in `docs/adr/`. See `docs/agents/domain.md`.

### Verification

Before choosing checks or reporting verification results, read [the toolchain guide](docs/toolchain.md) for command coverage and evidence boundaries. For product acceptance, follow [the T1–T9 handoff](docs/v1-implementation-handoff.md).

### UI changes

Before changing UI styles or components, read [the design standards](DESIGN.md). For theme integration, font provenance, or historical design references, see [the design reference](docs/design-reference.md).
