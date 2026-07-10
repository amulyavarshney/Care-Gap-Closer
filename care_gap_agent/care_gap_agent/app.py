"""
care_gap_agent — A2A application entry point.

    uvicorn care_gap_agent.app:a2a_app --host 0.0.0.0 --port 8001

Agent card published at:
    GET http://localhost:8001/.well-known/agent-card.json
"""
import os

from dotenv import load_dotenv

# Load .env BEFORE any module that reads env at import time (agent.py reads
# CARE_GAP_AGENT_MODEL; shared.middleware reads API_KEYS).
load_dotenv()

from shared.app_factory import create_a2a_app

from .agent import root_agent
from .resources import load_prompt, load_skills

_PORT = int(os.getenv("PORT", "8001"))
_PUBLIC_URL = os.getenv("CARE_GAP_AGENT_URL", os.getenv("BASE_URL", f"http://localhost:{_PORT}"))
_PO_BASE = os.getenv("PO_PLATFORM_BASE_URL", "https://app.promptopinion.ai")

# SMART scopes the MCP tools require to operate against a FHIR server.
# Keep aligned with care_gap_mcp/main.py — both must declare the same set.
_FHIR_SCOPES = [
    {"name": "patient/Patient.rs", "required": True},
    {"name": "patient/Condition.rs", "required": True},
    {"name": "patient/Observation.rs", "required": True},
    {"name": "patient/Procedure.rs", "required": True},
    {"name": "patient/Immunization.rs", "required": True},
    {"name": "patient/MedicationRequest.rs"},
]

a2a_app = create_a2a_app(
    agent=root_agent,
    name="care_gap_agent",
    description=load_prompt("agent_description"),
    url=_PUBLIC_URL,
    port=_PORT,
    fhir_extension_uri=f"{_PO_BASE}/schemas/a2a/v1/fhir-context",
    fhir_scopes=_FHIR_SCOPES,
    skills=load_skills(),
)
