# Care Gap A2A Agent

A2A v1 agent built on Google ADK + Gemini that finds USPSTF preventive care
gaps and drafts patient outreach. The agent has **no FHIR tools of its own** —
all FHIR work and content drafting is delegated to the
[Care Gap Closer MCP server](../care_gap_mcp/README.md), called over HTTP with
SHARP-on-MCP headers.

## Architecture

```
Prompt Opinion (cloud)
      │ A2A JSON-RPC + FHIR metadata
      ▼  (ngrok tunnel)
care_gap_agent  ──► Gemini (reasoning, tool selection)
  :8001         ──► Care Gap MCP Server (this project's MCP)
                       :9000 (ngrok tunnel)
                       SHARP headers carry FHIR context to MCP
                       MCP tools call FHIR + use Gemini for authorship
```

The agent's job is the multi-turn reasoning: deciding which MCP tool to call,
threading evidence between calls (`find_care_gaps` → `draft_outreach_message`),
and surfacing a concise summary to the clinician.

## Tools (all proxy to the MCP server)

- `summarize_patient`
- `list_active_conditions`
- `list_recent_observations`
- `find_care_gaps`
- `get_patient_risk_summary`
- `draft_outreach_message`

## Run locally

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # then fill in GOOGLE_API_KEY + API_KEY_PRIMARY

# Make sure the MCP server is already running at http://127.0.0.1:9000/mcp
uvicorn care_gap_agent.app:a2a_app --host 0.0.0.0 --port 8001 --log-level info
```

Verify the agent card:

```bash
curl http://localhost:8001/.well-known/agent-card.json
```

Run the smoke test (against the SMART Health IT public sandbox):

```bash
./scripts/test_care_gap_agent.sh
```

## A2A v1 / FHIR context

FHIR credentials are sent in the A2A message metadata under the extension URI
`{PO_PLATFORM_BASE_URL}/schemas/a2a/v1/fhir-context` with payload:

```json
{
  "fhirUrl": "https://r4.smarthealthit.org",
  "fhirToken": "...",
  "patientId": "..."
}
```

`shared/middleware.py` bridges this metadata into `params.metadata` and
`shared/fhir_hook.py` extracts it into the ADK session state before every LLM
call. The agent's tools then forward those values to the MCP server as
`X-FHIR-Server-URL`, `X-FHIR-Access-Token`, and `X-Patient-ID` headers.

## Register on the Prompt Opinion portal

1. Run `ngrok http 8001` and grab the HTTPS URL.
2. Set `BASE_URL=https://<id>.ngrok-free.app` in `.env` and restart the agent
   so the agent card advertises the public URL.
3. In your PO workspace, register an external A2A agent and point it at
   `https://<id>.ngrok-free.app/.well-known/agent-card.json`.
4. Provide the same `API_KEY_PRIMARY` value as the X-API-Key.
