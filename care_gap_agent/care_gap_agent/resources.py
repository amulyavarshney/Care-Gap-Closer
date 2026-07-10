"""Load agent prompts, skills, and routing rules from disk.

Path-aware single source of truth so agent.py / app.py never embed strings.
"""
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml
from a2a.types import AgentSkill

_AGENT_ROOT = Path(__file__).resolve().parent.parent
_PROMPTS_DIR = _AGENT_ROOT / "prompts"
_ROUTING_DIR = _AGENT_ROOT / "routing"


@lru_cache(maxsize=8)
def load_prompt(name: str) -> str:
    """Return contents of prompts/<name>.md."""
    return (_PROMPTS_DIR / f"{name}.md").read_text().strip()


@lru_cache(maxsize=1)
def load_skills() -> list[AgentSkill]:
    """Return AgentSkill objects parsed from prompts/skills.yaml."""
    with (_PROMPTS_DIR / "skills.yaml").open() as f:
        doc = yaml.safe_load(f)
    return [
        AgentSkill(
            id=s["id"],
            name=s["name"],
            description=" ".join(s["description"].split()),  # collapse YAML folds
            tags=s.get("tags") or [],
            examples=s.get("examples") or [],
        )
        for s in doc.get("skills", [])
    ]


@lru_cache(maxsize=1)
def load_routing_rules() -> dict[str, Any]:
    """Return parsed routing/rules.yaml (documentation; not enforced in code)."""
    with (_ROUTING_DIR / "rules.yaml").open() as f:
        return yaml.safe_load(f)
