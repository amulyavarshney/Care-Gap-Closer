"""
Shared tools catalogue.

care_gap.py — proxies to the Care Gap Closer MCP server over HTTP, forwarding
FHIR context as SHARP-on-MCP headers.
"""

from .care_gap import (
    draft_outreach_message,
    find_care_gaps,
    get_patient_risk_summary,
    list_active_conditions,
    list_recent_observations,
    summarize_patient,
)

__all__ = [
    "summarize_patient",
    "list_active_conditions",
    "list_recent_observations",
    "find_care_gaps",
    "get_patient_risk_summary",
    "draft_outreach_message",
]
