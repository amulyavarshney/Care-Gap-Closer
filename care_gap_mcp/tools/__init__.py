from fastmcp import FastMCP

from tools import care_gaps, conditions, observations, outreach, patient_summary, risk_summary


def register_tools(mcp: FastMCP) -> None:
    patient_summary.register(mcp)
    conditions.register(mcp)
    observations.register(mcp)
    care_gaps.register(mcp)
    risk_summary.register(mcp)
    outreach.register(mcp)
