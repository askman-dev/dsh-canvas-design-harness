# Specs Map Instructions (design harness)

This directory follows the repository spec protocol in
`docs/specs_map/AGENTS.md`: specs are the source for tests and for short
implementation comments at fragile boundaries.

Rules kept from the project protocol:

- Use one YAML file per contract group; `spec_id` is the stable identifier.
- Keep each `expected_behavior` item short, concrete, and testable.
- Do not add speculative behavior: specs describe what the harness actually
  does or is explicitly contracted to do.
- Add `// Spec: <spec_id>` or `// Specs: <id_a>, <id_b>` at the key entry
  point of each implementation file and in the direct regression check.
- Do not add code owners, timestamps, or version fields.

Because these specs live inside the skill (not under `docs/specs_map/`), the
repository-wide `npm run check:spec-traceability` does not scan them; anchors
are still required so the skill can be validated independently.
