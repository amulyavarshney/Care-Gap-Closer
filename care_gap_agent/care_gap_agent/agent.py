"""
care_gap_agent — A2A agent for USPSTF preventive care gap workflows.

The agent has no FHIR tools of its own; it delegates ALL data access and
content authorship to the Care Gap Closer MCP server. Its instruction, model
choice, and tool list are the only Python-level concerns — instruction text
itself lives in prompts/agent_instruction.md so non-engineers can edit it.
"""
import os

from google.adk.agents import Agent
from google.adk.models.lite_llm import LiteLlm

from shared.fhir_hook import extract_fhir_context
from shared.tools import (
    draft_outreach_message,
    find_care_gaps,
    get_patient_risk_summary,
    list_active_conditions,
    list_recent_observations,
    summarize_patient,
)

from .resources import load_prompt

_model_name = os.getenv("CARE_GAP_AGENT_MODEL", "gemini/gemini-2.5-flash")
_model = LiteLlm(model=_model_name)

root_agent = Agent(
    name="care_gap_agent",
    model=_model,
    description=load_prompt("agent_description"),
    instruction=load_prompt("agent_instruction"),
    tools=[
        summarize_patient,
        list_active_conditions,
        list_recent_observations,
        find_care_gaps,
        get_patient_risk_summary,
        draft_outreach_message,
    ],
    before_model_callback=extract_fhir_context,
)
