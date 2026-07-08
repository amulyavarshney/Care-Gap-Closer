"""Patient risk summary — aggregates demographics + open gaps into one
risk-stratified view. Reuses the same rule evaluation as FindCareGaps
(tools/care_gaps.py: compute_gaps) so the two tools never disagree about
what counts as a gap; this tool only adds a severity rollup on top.

No rationale authoring here — this is a fast, deterministic overview meant
to answer "how does this patient stack up" before drilling into FindCareGaps
for the full per-gap detail and outreach drafting.
"""
from po_fastmcp import get_fhir_context

from tools.care_gaps import compute_gaps


def register(mcp) -> None:
    mcp.tool(name="GetPatientRiskSummary")(get_patient_risk_summary)


async def get_patient_risk_summary() -> dict:
    """Return a risk-stratified summary of the current patient's care gaps.

    Aggregates age, gender, and open USPSTF gaps into a single overview:
    total gap count, counts by severity, and an overall risk_level
    (high | medium | low) driven by how many high/medium severity gaps are
    open. Use this for a quick "how urgent is this patient" read before
    calling FindCareGaps for full per-gap evidence and rationale.
    """
    context = get_fhir_context()
    if context is None or not context.patient_id:
        return {"status": "error", "message": "FHIR context with patient_id is required."}

    result = await compute_gaps(context)
    if result is None:
        return {"status": "error", "message": "Patient not found."}

    age, gender, gaps = result
    by_severity = {"high": 0, "medium": 0, "low": 0}
    for gap in gaps:
        severity = gap.get("severity", "low")
        by_severity[severity] = by_severity.get(severity, 0) + 1

    return {
        "status": "success",
        "patient_id": context.patient_id,
        "age": age,
        "gender": gender,
        "gap_count": len(gaps),
        "gaps_by_severity": by_severity,
        "risk_level": _risk_level(by_severity),
        "gap_titles": [gap["title"] for gap in gaps],
    }


def _risk_level(by_severity: dict[str, int]) -> str:
    if by_severity.get("high", 0) >= 1:
        return "high"
    if by_severity.get("medium", 0) >= 1:
        return "medium"
    if by_severity.get("low", 0) >= 1:
        return "low"
    return "low"
