"""Care gap finder — data-driven USPSTF rule engine + Gemini rationale.

The rule engine is deterministic and 100% defined by YAML files:
    knowledge_base/care_gap_rules.yaml   what counts as a gap
    knowledge_base/terminology.yaml      what FHIR codes belong to each set

The LLM (Gemini) is only asked to author the per-patient clinical rationale
off the rule's structured `evidence` dict. The LLM never invents a gap; if
the LLM is unavailable, we fall back to the rule's `rationale_template`.
"""
import os
from datetime import date, datetime, timezone
from typing import Any

from fhir.resources.patient import Patient

from po_fastmcp import (
    FhirClient,
    get_fhir_context,
    load_care_gap_rules,
    load_prompt,
    matches_code_set,
)


def register(mcp) -> None:
    mcp.tool(name="FindCareGaps")(find_care_gaps)


async def find_care_gaps() -> dict:
    """Identify USPSTF-aligned preventive care gaps for the current patient.

    Each gap has: id, title, severity, uspstf_grade, evidence (raw FHIR-derived
    facts that triggered the rule), and rationale (LLM-authored one-sentence
    clinician-facing). Patients with no gaps return gap_count=0.
    """
    context = get_fhir_context()
    if context is None or not context.patient_id:
        return {"status": "error", "message": "FHIR context with patient_id is required."}

    result = await compute_gaps(context)
    if result is None:
        return {"status": "error", "message": "Patient not found."}

    age, gender, gaps = result
    for gap in gaps:
        gap["rationale"] = _author_rationale(gap, age, gender)

    return {
        "status": "success",
        "patient_id": context.patient_id,
        "age": age,
        "gender": gender,
        "gap_count": len(gaps),
        "gaps": gaps,
    }


async def compute_gaps(context) -> tuple[int | None, str, list[dict[str, Any]]] | None:
    """Fetch FHIR data and evaluate all rules. Shared by FindCareGaps and
    GetPatientRiskSummary so both use one FHIR fetch + rule-eval path.

    Returns (age, gender, gaps) with gaps missing their `rationale` field
    (callers that need rationale must author it themselves), or None if the
    patient can't be found.
    """
    client = FhirClient(context)

    patient_resource = await client.read("Patient", context.patient_id)
    if patient_resource is None:
        return None
    patient = Patient.model_validate(patient_resource)
    age = _age(patient.birthDate)
    gender = (patient.gender or "").lower()

    conditions = await client.search(
        "Condition",
        {"patient": context.patient_id, "clinical-status": "active"},
        limit=100,
    )
    observations = await client.search(
        "Observation",
        {"patient": context.patient_id, "_sort": "-date"},
        limit=200,
    )
    procedures = await client.search(
        "Procedure",
        {"patient": context.patient_id, "_sort": "-date"},
        limit=100,
    )
    immunizations = await client.search(
        "Immunization",
        {"patient": context.patient_id, "_sort": "-date"},
        limit=100,
    )

    rules = load_care_gap_rules().get("rules", [])
    gaps: list[dict[str, Any]] = []
    for rule in rules:
        gap = _evaluate_rule(rule, age, gender, conditions, observations, procedures, immunizations)
        if gap is not None:
            gaps.append(gap)

    return age, gender, gaps


# ── Rule evaluation ──────────────────────────────────────────────────────────

def _evaluate_rule(
    rule: dict,
    age: int | None,
    gender: str,
    conditions: list,
    observations: list,
    procedures: list,
    immunizations: list,
) -> dict | None:
    """Apply a single rule. Return a gap dict if triggered, else None."""
    if not _demographics_match(rule.get("demographics") or {}, age, gender):
        return None

    triggers = rule.get("triggers") or {}
    if not _triggers_match(triggers, conditions):
        return None

    thresh = rule.get("thresholds") or {}
    evidence = _build_evidence(
        rule, age, gender, conditions, observations, procedures, immunizations, thresh
    )
    if evidence is None:
        return None   # threshold not crossed; not a gap

    return {
        "id": rule["id"],
        "title": rule["title"],
        "severity": rule["severity"],
        "uspstf_grade": rule["uspstf_grade"],
        "evidence": evidence,
    }


def _demographics_match(demo: dict, age: int | None, gender: str) -> bool:
    if "gender" in demo and gender != demo["gender"]:
        return False
    if "age_min" in demo or "age_max" in demo:
        if age is None:
            return False
        if "age_min" in demo and age < demo["age_min"]:
            return False
        if "age_max" in demo and age > demo["age_max"]:
            return False
    return True


def _triggers_match(triggers: dict, conditions: list) -> bool:
    """All trigger predicates must hold. Currently supports condition_in."""
    if not triggers:
        return True
    condition_sets = triggers.get("condition_in") or []
    if condition_sets:
        if not any(_has_condition_in(conditions, cs) for cs in condition_sets):
            return False
    return True


def _has_condition_in(conditions: list, code_set_name: str) -> bool:
    for res in conditions:
        for c in (res.get("code", {}) or {}).get("coding", []) or []:
            if matches_code_set(c, code_set_name):
                return True
    return False


def _build_evidence(
    rule: dict,
    age: int | None,
    gender: str,
    conditions: list,
    observations: list,
    procedures: list,
    immunizations: list,
    thresh: dict,
) -> dict | None:
    """Return evidence dict iff a threshold predicate is crossed."""
    evidence: dict[str, Any] = {}
    if age is not None:
        evidence["age"] = age
    if gender:
        evidence["gender"] = gender

    # Single-observation threshold.
    if "observation" in thresh:
        spec = thresh["observation"]
        recent = _most_recent_observation(observations, spec["code_set"])
        months = _months_since(recent)
        if months <= spec["max_months_since"]:
            return None
        evidence.update({
            "last_observation_date": (recent or {}).get("date"),
            "last_observation_value": (recent or {}).get("value"),
            "months_since_last": _round_months(months),
            "max_allowed_months": spec["max_months_since"],
        })
        return evidence

    # Single-procedure threshold.
    if "procedure" in thresh:
        spec = thresh["procedure"]
        recent = _most_recent_procedure(procedures, spec["code_set"])
        months = _months_since(recent)
        if months <= spec["max_months_since"]:
            return None
        evidence.update({
            "last_procedure_date": (recent or {}).get("date"),
            "last_procedure_label": (recent or {}).get("label"),
            "months_since_last": _round_months(months),
            "max_allowed_months": spec["max_months_since"],
        })
        return evidence

    # ANY-of procedure thresholds — pass if ANY listed procedure code set is
    # within its own max_months_since (e.g. colorectal: colonoscopy in 10y OR
    # FIT in 1y). The gap fires only when ALL options are stale.
    if "procedure_any" in thresh:
        options = thresh["procedure_any"]
        best: dict | None = None     # the most-recent screening across options
        any_fresh = False
        for opt in options:
            recent = _most_recent_procedure(procedures, opt["code_set"])
            months = _months_since(recent)
            if months <= opt["max_months_since"]:
                any_fresh = True
                break
            if recent is not None and (best is None or months < _months_since(best)):
                best = recent
        if any_fresh:
            return None
        evidence.update({
            "last_screening_date": (best or {}).get("date"),
            "last_screening_label": (best or {}).get("label"),
            "options": [
                {"code_set": o["code_set"], "max_allowed_months": o["max_months_since"]}
                for o in options
            ],
        })
        return evidence

    # Single-immunization threshold. max_months_since: 9999 models "one-time
    # series" vaccines (e.g. shingles, pneumococcal) where any prior dose on
    # record satisfies the gap indefinitely.
    if "immunization" in thresh:
        spec = thresh["immunization"]
        recent = _most_recent_immunization(immunizations, spec["code_set"])
        months = _months_since(recent)
        if months <= spec["max_months_since"]:
            return None
        evidence.update({
            "last_immunization_date": (recent or {}).get("date"),
            "last_immunization_label": (recent or {}).get("label"),
            "months_since_last": _round_months(months),
            "max_allowed_months": spec["max_months_since"],
        })
        return evidence

    return None   # rule has no recognised threshold shape


# ── FHIR resource helpers ────────────────────────────────────────────────────

def _most_recent_observation(observations: list, code_set_name: str) -> dict | None:
    matches = []
    for res in observations:
        for c in (res.get("code", {}) or {}).get("coding", []) or []:
            if matches_code_set(c, code_set_name):
                d = res.get("effectiveDateTime") or (res.get("effectivePeriod") or {}).get("start")
                vq = res.get("valueQuantity", {}) or {}
                matches.append({"date": d, "value": vq.get("value"), "unit": vq.get("unit")})
                break
    if not matches:
        return None
    return sorted(matches, key=lambda m: m["date"] or "", reverse=True)[0]


def _most_recent_procedure(procedures: list, code_set_name: str) -> dict | None:
    matches = []
    for res in procedures:
        for c in (res.get("code", {}) or {}).get("coding", []) or []:
            if matches_code_set(c, code_set_name):
                d = res.get("performedDateTime") or (res.get("performedPeriod") or {}).get("start")
                matches.append({"date": d, "cpt": c.get("code"), "label": c.get("display")})
                break
    if not matches:
        return None
    return sorted(matches, key=lambda m: m["date"] or "", reverse=True)[0]


def _most_recent_immunization(immunizations: list, code_set_name: str) -> dict | None:
    matches = []
    for res in immunizations:
        for c in (res.get("vaccineCode", {}) or {}).get("coding", []) or []:
            if matches_code_set(c, code_set_name):
                d = res.get("occurrenceDateTime")
                matches.append({"date": d, "cvx": c.get("code"), "label": c.get("display")})
                break
    if not matches:
        return None
    return sorted(matches, key=lambda m: m["date"] or "", reverse=True)[0]


def _age(birth_date) -> int | None:
    if birth_date is None:
        return None
    if isinstance(birth_date, str):
        birth_date = datetime.fromisoformat(birth_date).date()
    today = date.today()
    return today.year - birth_date.year - ((today.month, today.day) < (birth_date.month, birth_date.day))


def _months_since(record: dict | None) -> float:
    if not record or not record.get("date"):
        return float("inf")
    try:
        d = datetime.fromisoformat(record["date"].replace("Z", "+00:00"))
    except ValueError:
        return float("inf")
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    delta = datetime.now(timezone.utc) - d
    return delta.days / 30.4375


def _round_months(months: float) -> float | None:
    if months == float("inf"):
        return None
    return round(months, 1)


# ── Gemini rationale authoring ───────────────────────────────────────────────

def _author_rationale(gap: dict, age: int | None, gender: str) -> str:
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        return _fallback_rationale(gap)

    try:
        from google import genai

        client = genai.Client(api_key=api_key)
        system_prompt = load_prompt("rationale_system")
        prompt = (
            f"{system_prompt}\n\n"
            f"Patient age: {age}\n"
            f"Patient gender: {gender}\n"
            f"Gap title: {gap['title']}\n"
            f"USPSTF grade: {gap['uspstf_grade']}\n"
            f"Evidence: {gap['evidence']}\n\n"
            "Write the one-sentence rationale now."
        )
        response = client.models.generate_content(
            model=os.getenv("GEMINI_MODEL", "gemini-2.5-flash"),
            contents=prompt,
        )
        return (response.text or "").strip() or _fallback_rationale(gap)
    except Exception as e:
        return _fallback_rationale(gap, error=str(e))


def _fallback_rationale(gap: dict, error: str | None = None) -> str:
    # Use the rule's own rationale_template from YAML when LLM is unavailable.
    rules = load_care_gap_rules().get("rules", [])
    template = next((r.get("rationale_template", "").strip() for r in rules if r["id"] == gap["id"]), "")
    base = template or f"USPSTF Grade {gap['uspstf_grade']} screening recommended per evidence above."
    if error:
        return f"{base} (LLM unavailable: {error})"
    return base
