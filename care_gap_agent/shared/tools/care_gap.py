"""
Care-gap tools — call this project's own MCP server over HTTP.

Each tool reads FHIR credentials (fhir_url, fhir_token, patient_id) from the
ADK ToolContext state (populated by shared.fhir_hook.extract_fhir_context),
then forwards them to the MCP server as SHARP-on-MCP HTTP headers:

    X-FHIR-Server-URL
    X-FHIR-Access-Token
    X-Patient-ID

This is the agent-uses-its-own-MCP pattern: the agent does the LLM reasoning,
the MCP server does the deterministic FHIR work + LLM-authored copy.

Set MCP_SERVER_URL in the env (default: http://127.0.0.1:9000/mcp).

Implementation note: FastMCP Streamable HTTP requires an initialize handshake
before tools/call. We use the official `mcp` Python client SDK which manages
that for us — one ClientSession per tool call (cheap; <100ms overhead).
"""
import json
import logging
import os

from google.adk.tools import ToolContext
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

logger = logging.getLogger(__name__)

_DEFAULT_MCP_URL = "http://127.0.0.1:9000/mcp"


def _mcp_url() -> str:
    return os.getenv("MCP_SERVER_URL", _DEFAULT_MCP_URL)


def _fhir_headers(tool_context: ToolContext) -> dict | None:
    """Build SHARP headers from session state, or None if context missing."""
    fhir_url = tool_context.state.get("fhir_url", "")
    fhir_token = tool_context.state.get("fhir_token", "")
    patient_id = tool_context.state.get("patient_id", "")
    missing = [
        n for n, v in [
            ("fhir_url", fhir_url),
            ("fhir_token", fhir_token),
            ("patient_id", patient_id),
        ]
        if not v
    ]
    if missing:
        return None
    return {
        "X-FHIR-Server-URL": fhir_url,
        "X-FHIR-Access-Token": fhir_token,
        "X-Patient-ID": patient_id,
    }


def _missing_context_error() -> dict:
    return {
        "status": "error",
        "error_message": (
            "FHIR context not available — the caller must include "
            "fhir-context in the A2A message metadata with fhirUrl, "
            "fhirToken, and patientId."
        ),
    }


async def _call_mcp_tool(name: str, arguments: dict, headers: dict) -> dict:
    """Call an MCP tool with a fresh session (handshake + call + close).

    The MCP Streamable HTTP transport carries our SHARP headers on every HTTP
    request, including the initialize call — so the server has FHIR context
    available throughout the session.
    """
    try:
        async with streamablehttp_client(_mcp_url(), headers=headers) as (
            read_stream,
            write_stream,
            _get_session_id,
        ):
            async with ClientSession(read_stream, write_stream) as session:
                await session.initialize()
                result = await session.call_tool(name=name, arguments=arguments)
    except Exception as e:
        logger.exception("mcp_call_failed name=%s", name)
        return {
            "status": "error",
            "error_message": f"MCP call to '{name}' failed: {e}",
        }

    # mcp.types.CallToolResult: { content: [TextContent|...], isError: bool, structuredContent? }
    if getattr(result, "isError", False):
        text = _extract_text(result.content)
        return {"status": "error", "error_message": text or f"MCP tool '{name}' reported error"}

    # Prefer structuredContent when the tool returned a dict; fall back to parsing text.
    structured = getattr(result, "structuredContent", None)
    if isinstance(structured, dict) and structured:
        return structured

    text = _extract_text(result.content)
    if text is None:
        return {"status": "success"}
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return {"status": "success", "text": text}


def _extract_text(content) -> str | None:
    if not content:
        return None
    for item in content:
        # mcp.types.TextContent has .type == "text" and .text
        if getattr(item, "type", None) == "text":
            return getattr(item, "text", None)
    return None


# ── Tool wrappers (one per MCP tool) ──────────────────────────────────────────

async def summarize_patient(tool_context: ToolContext) -> dict:
    """Get the current patient's demographics and age from the connected FHIR record."""
    headers = _fhir_headers(tool_context)
    if headers is None:
        return _missing_context_error()
    logger.info("agent_tool_summarize_patient")
    return await _call_mcp_tool("SummarizePatient", {}, headers)


async def list_active_conditions(tool_context: ToolContext) -> dict:
    """Get the current patient's active problem list (conditions/diagnoses)."""
    headers = _fhir_headers(tool_context)
    if headers is None:
        return _missing_context_error()
    logger.info("agent_tool_list_active_conditions")
    return await _call_mcp_tool("ListActiveConditions", {}, headers)


async def list_recent_observations(months_back: int, tool_context: ToolContext) -> dict:
    """Get the patient's recent labs, vitals, and screening procedures.

    Args:
        months_back: How far back to look. Use 24 for a typical default.
    """
    headers = _fhir_headers(tool_context)
    if headers is None:
        return _missing_context_error()
    logger.info("agent_tool_list_recent_observations months_back=%d", months_back)
    return await _call_mcp_tool("ListRecentObservations", {"months_back": months_back}, headers)


async def find_care_gaps(tool_context: ToolContext) -> dict:
    """Identify USPSTF-aligned preventive care gaps for the current patient.

    Returns a list of gaps with structured evidence and an LLM-authored
    clinician-facing rationale for each. Use this BEFORE drafting outreach.
    """
    headers = _fhir_headers(tool_context)
    if headers is None:
        return _missing_context_error()
    logger.info("agent_tool_find_care_gaps")
    return await _call_mcp_tool("FindCareGaps", {}, headers)


async def get_patient_risk_summary(tool_context: ToolContext) -> dict:
    """Get a quick risk-stratified overview of the current patient's care gaps.

    Returns gap_count, a severity breakdown (high/medium/low), an overall
    risk_level, and the list of gap titles — no per-gap evidence or rationale.
    Use this for a fast "how urgent is this patient" read; call
    find_care_gaps afterward when the clinician wants full detail on a gap.
    """
    headers = _fhir_headers(tool_context)
    if headers is None:
        return _missing_context_error()
    logger.info("agent_tool_get_patient_risk_summary")
    return await _call_mcp_tool("GetPatientRiskSummary", {}, headers)


async def draft_outreach_message(
    gap: dict,
    patient_name: str,
    channel: str,
    tool_context: ToolContext,
) -> dict:
    """Draft a patient-facing outreach message for a specific care gap.

    Args:
        gap: A gap dict returned by find_care_gaps (must include id and evidence).
        patient_name: First name to personalize the message. Pass empty string to skip.
        channel: 'sms' (<=160 chars), 'portal' (3 short paragraphs), or 'both'.
    """
    headers = _fhir_headers(tool_context)
    if headers is None:
        return _missing_context_error()
    logger.info("agent_tool_draft_outreach gap_id=%s channel=%s", gap.get("id"), channel)
    return await _call_mcp_tool(
        "DraftOutreachMessage",
        {
            "gap": gap,
            "patient_name": patient_name or None,
            "channel": channel,
        },
        headers,
    )
