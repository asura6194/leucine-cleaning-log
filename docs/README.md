# docs

Design and process record for the Equipment Cleaning Log.

| File | What it is | Audience |
|---|---|---|
| `Design-and-Requirements-Specification.pdf` | The design record: entity model, ER diagram, column-level schema, the audited write path, and the full functional / non-functional requirement set with each requirement traced to the assignment brief. **This is the document to hand over.** | Reviewer |
| `Design-and-Requirements-Specification.docx` | Editable source of the above. | Author |
| `More-Information.pdf` | Supplementary design reasoning for the parts a reader may reasonably question — currently roles and the seeded accounts: why they exist, what is actually enforced and where, the deliberate gap where `admin` does nothing different, and the questions the design invites with the answers. Grows as topics come up. | Reviewer |
| `More-Information.docx` | Editable source of the above. | Author |
| `database-layer.md` | Reference for the database layer as built: schema decisions, what the seed produces and why, verification queries with expected values, and a local-setup troubleshooting log. | Both |
| `postman/` | The Postman collection and its own README. Import the `.json` and run it; `api-testing.md` explains what each folder proves. | Both |
| `api-testing.md` | How to exercise the API: the Postman collection and what each folder proves, Newman on the command line, curl (with the Windows shell traps spelled out), and what the automated suite covers. | Both |
| `diagrams/er-diagram.png` | Entity relationships. Solid arrows are enforced foreign keys; the dashed arrow is the one relationship the database deliberately does not enforce. | Both |
| `diagrams/audit-write-path.png` | Order of operations inside `PATCH /api/cleaning-records/:id`, including the transaction boundary and the empty-diff short circuit. | Both |

The specification was written before implementation. Where the build has
since diverged from it, the divergence is recorded in [`../NOTES.md`](../NOTES.md)
rather than by quietly editing the specification — the point of the document is
to show what was decided up front and what changed once the code met reality.
