# Care Gap Closer MCP Server

A SHARP-on-MCP server that exposes six tools for USPSTF-aligned preventive
care-gap detection and patient outreach. Built on `fastmcp` with the Prompt
Opinion `POFastMCP` extension for FHIR context.

## Tools

| Tool | What it does | LLM? |
|---|---|---|
| `SummarizePatient` | Returns demographics + computed age | No |
| `ListActiveConditions` | Active problem list with SNOMED + ICD-10 codes | No |
| `ListRecentObservations` | Labs, vitals, and screening procedures within N months | No |
| `FindCareGaps` | **Rule engine** identifies USPSTF gaps; **Gemini** authors the per-patient clinical rationale | Yes |
| `GetPatientRiskSummary` | Severity rollup (`risk_level` + counts by severity) — skips per-gap rationale for speed | No |
| `DraftOutreachMessage` | Gemini drafts SMS + portal copy for a specific gap, sixth-grade reading level | Yes |

The rule engine is deterministic — we never let the LLM invent a gap. The LLM
is only used for *authorship* (rationale, patient copy), which is exactly what
rule-based systems can't do.

## Care gaps implemented

- **Diabetes A1c overdue** — active DM (E10/E11/E13) + no LOINC 4548-4 in 6mo
- **Hypertension BP overdue** — active HTN (I10–I15) + no LOINC 8480-6 in 12mo
- **Colorectal screening overdue** — age 45–75 + no colonoscopy in 10y / FIT in 1y
- **Mammography overdue** — female, age 40–74 + no mammogram in 24mo
- **Cervical screening overdue** — female, age 21–65 + no Pap in 3y / HPV co-test in 5y
- **Lipid panel overdue** — age 40+ + no lipid panel in 5y
- **Lung cancer screening overdue** — smoker, age 50–80 + no LDCT in 1y
- **Osteoporosis screening overdue** — female, age 65+ + no DEXA in 24mo
- **Depression screening overdue** — age 18+ + no PHQ-9 in 12mo
- **Influenza, Tdap, pneumococcal, and shingles vaccines overdue** — age/interval-gated per ACIP schedule

See [`knowledge_base/care_gap_rules.yaml`](knowledge_base/care_gap_rules.yaml) for
the full rule definitions — new rules that fit an existing threshold shape
(`observation`, `procedure`, `procedure_any`, `immunization`) are pure YAML
edits, no code changes required.

## Run locally

```shell
cd care_gap_mcp
uv sync
GOOGLE_API_KEY=your-key uv run python main.py
```

Server listens at `http://127.0.0.1:9000/mcp`.

## FHIR context

Per SHARP-on-MCP, FHIR credentials arrive as HTTP headers:

- `X-FHIR-Server-URL`
- `X-FHIR-Access-Token`
- `X-Patient-ID`

If any required header is missing on a patient-specific tool, the tool returns
`{"status": "error", "message": "..."}`.

## Expose to the Prompt Opinion portal

Run `ngrok http 9000` and register the resulting `https://<id>.ngrok-free.app/mcp`
URL in your PO workspace's MCP server registry.
