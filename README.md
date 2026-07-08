# Care Gap Closer — Agents Assemble Healthcare AI Endgame

A full-stack submission for the **Agents Assemble** hackathon: an A2A agent
that uses its own MCP server to find USPSTF-aligned preventive care gaps for
a patient and draft outreach to close them — registered into the Prompt
Opinion platform via SHARP-on-MCP and A2A v1 + FHIR context.

## What's in here

```
Agent_Assemble/
├── care_gap_mcp/      # MCP server — 6 tools, FastMCP + POFastMCP, SHARP headers
└── care_gap_agent/    # A2A agent — Google ADK + Gemini, calls its own MCP
```

Each subdirectory has its own README with setup instructions.

## Architecture

```
Prompt Opinion portal (cloud)
      │  A2A JSON-RPC + FHIR metadata (per A2A v1 + PO extension URI)
      ▼  ngrok tunnel → :8001
┌────────────────────────────────────────────────────────────────┐
│  care_gap_agent  (Google ADK · Gemini · A2A v1)                 │
│   • shared.middleware bridges metadata → params.metadata        │
│   • shared.fhir_hook extracts FHIR context into session state   │
│   • 6 ADK tools, each forwards FHIR context as SHARP headers    │
└─────────────────────────┬───────────────────────────────────────┘
                          │  HTTP (SHARP-on-MCP)
                          │   X-FHIR-Server-URL
                          │   X-FHIR-Access-Token
                          │   X-Patient-ID
                          ▼
┌────────────────────────────────────────────────────────────────┐
│  care_gap_mcp  (FastMCP · POFastMCP · ai.promptopinion/fhir-context)│
│   • SummarizePatient        ─┐                                  │
│   • ListActiveConditions     │ deterministic FHIR queries       │
│   • ListRecentObservations  ─┘                                  │
│   • FindCareGaps             rule engine + Gemini rationale     │
│   • GetPatientRiskSummary    severity rollup + risk level       │
│   • DraftOutreachMessage     Gemini patient-language outreach   │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
                   FHIR R4 server
              (SMART Health IT sandbox or any
               PO-bridged EHR FHIR endpoint)
```

## The AI Factor

Rule-based engines have flagged "patient overdue for A1c" for two decades.
What they can't do is write the **patient-specific clinical rationale** that a
care manager would actually use, or the **sixth-grade-reading-level outreach
text** that a patient would actually read. Both are LLM authorship problems —
exactly where Gemini earns its place in the pipeline.

The rule engine stays deterministic: every gap is grounded in a SNOMED/ICD-10
diagnosis + a missing or stale LOINC observation / CPT procedure. The LLM
never invents a gap — it only authors *copy* off structured evidence.

## Care gaps implemented

| Rule | Trigger |
|---|---|
| `diabetes-a1c-overdue` | active DM (SNOMED 44054006/73211009 or ICD-10 E10/E11/E13) + no LOINC 4548-4 in 6mo |
| `hypertension-bp-overdue` | active HTN (SNOMED 38341003 or ICD-10 I10–I15) + no LOINC 8480-6 in 12mo |
| `colorectal-screening-overdue` | age 45–75 + no CPT 45378/45380/45385 in 10y / 82270 in 1y |
| `mammography-overdue` | female, age 40–74 + no CPT 77065/77066/77067 in 24mo |
| `cervical-screening-overdue` | female, age 21–65 + no CPT 88142/88150/88164 in 3y / 87624 in 5y |
| `lipid-panel-overdue` | age 40+ + no LOINC 2093-3/13457-7/57698-3 in 5y |
| `lung-cancer-screening-overdue` | tobacco use (SNOMED) + age 50–80 + no CPT 71271 in 1y |
| `osteoporosis-screening-overdue` | female, age 65+ + no CPT 77080 in 24mo |
| `depression-screening-overdue` | age 18+ + no LOINC 44249-1 (PHQ-9) in 12mo |
| `influenza-vaccine-overdue` | age 18+ + no CVX 88/141/150/158 in 12mo |
| `tdap-vaccine-overdue` | age 18+ + no CVX 115/07 in 10y |
| `pneumococcal-vaccine-overdue` | age 65+ + no CVX 33/133/215 ever |
| `shingles-vaccine-overdue` | age 50+ + no CVX 187 ever |

New rules that fit the `observation`/`procedure`/`procedure_any`/`immunization`
threshold shapes are pure YAML edits to `knowledge_base/care_gap_rules.yaml` +
`terminology.yaml` — no code changes required.

## Standards used

- **MCP** (Model Context Protocol) — FastMCP, exposes 6 tools
- **SHARP-on-MCP** — `ai.promptopinion/fhir-context` capability extension declares
  required SMART scopes; FHIR context arrives as `X-FHIR-Server-URL`,
  `X-FHIR-Access-Token`, `X-Patient-ID` headers
- **A2A v1** — agent card with `supportedInterfaces`, nested `apiKeySecurityScheme`,
  FHIR extension via `params.scopes`
- **FHIR R4** — Patient, Condition, Observation, Procedure, Immunization
  resources via the SMART Health IT public Synthea sandbox
  (`https://r4.smarthealthit.org`)
- **Prompt Opinion FHIR context propagation** — both flavors (MCP headers + A2A
  metadata) wired end-to-end

## Quick demo (proven working)

Verified end-to-end against a real Synthea patient (Danae Kshlerin, 61F):

```
ListActiveConditions → 11 conditions including SNOMED 44054006 (Diabetes)
FindCareGaps         → 3 gaps:
  • HbA1c overdue (last A1c 65.8 months ago — Nov 2020)
  • Colorectal screening overdue (none on record)
  • Mammography overdue (none on record)
```

## Running locally

See [care_gap_mcp/README.md](care_gap_mcp/README.md) and
[care_gap_agent/README.md](care_gap_agent/README.md) for per-service setup.

The 30-second version, in three terminals:

```bash
# Terminal 1 — MCP server
cd care_gap_mcp
uv sync
GOOGLE_API_KEY=your-key MCP_PORT=9000 uv run python main.py

# Terminal 2 — A2A agent
cd care_gap_agent
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # fill GOOGLE_API_KEY + API_KEY_PRIMARY
uvicorn care_gap_agent.app:a2a_app --host 0.0.0.0 --port 8001

# Terminal 3 — ngrok tunnels for the PO portal
ngrok http 8001    # tunnel for the agent
ngrok http 9000    # tunnel for the MCP server (separate ngrok session)
```

Then in the Prompt Opinion portal:
1. Register the MCP server: paste the MCP ngrok URL + `/mcp`.
2. Register the A2A agent: paste the agent ngrok URL — PO discovers
   `/.well-known/agent-card.json` automatically.
3. Provide the `API_KEY_PRIMARY` value as the X-API-Key.
4. Connect a workspace FHIR source. Open a patient. Ask the agent:
   *"What preventive care gaps does this patient have?"*

See [DEMO_SCRIPT.md](DEMO_SCRIPT.md) for the 3-minute video walkthrough.

## Why this hits the judging criteria

- **AI Factor** — Gemini does what rules can't: per-patient rationale and
  patient-friendly outreach copy. The rule engine guarantees we never invent
  a gap.
- **Potential Impact** — care-gap closure is a billable, measured workflow
  (HEDIS, MIPS, Star Ratings). The bottleneck isn't detecting gaps; it's
  authoring outreach at scale.
- **Feasibility** — read-only FHIR + draft messages (clinician-reviewed before
  send). FHIR context never appears in prompts. SHARP scopes declared.
  Drop-in to any SMART-on-FHIR EHR session that PO bridges.

## License

MIT
