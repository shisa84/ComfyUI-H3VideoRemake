"""The six-section H3 full-reference prompt, filled from the Prompt editor and from Media Input's data."""

from __future__ import annotations

import json
import re

SECTION_ORDER = ("subject_definitions", "summary", "retention_analysis", "detailed_description",
                 "overall_soundscape", "non_diegetic_music")
_HEADER = re.compile(r"^\s*(" + "|".join(SECTION_ORDER) + r")\s*:\s*(.*)$")

# All six headers; subject_definitions and retention_analysis are left empty so data fills them.
DEFAULT_USER_PROMPT = "\n\n".join(f"{name}:\n" for name in SECTION_ORDER)


def split_sections(text: str) -> dict[str, str]:
    """Section name -> body. Text before the first header counts as summary."""
    sections: dict[str, list[str]] = {}
    current = "summary"
    for line in text.splitlines():
        match = _HEADER.match(line)
        if match:
            current = match.group(1)
            sections.setdefault(current, [])
            line = match.group(2)
            if not line:
                continue
        sections.setdefault(current, []).append(line)
    return {name: "\n".join(lines).strip() for name, lines in sections.items()}


def data_sections(data: str | None) -> dict[str, str]:
    parsed = json.loads(data) if data else {}
    return {name: str(parsed.get(name) or "").strip() for name in SECTION_ORDER}


def assemble_prompt(user_text: str, data: str | None) -> str:
    """The six sections in H3 order, empty ones included: the editor's text, or data's where the editor's is empty."""
    sections = data_sections(data)
    sections.update({name: body for name, body in split_sections(user_text).items() if body})
    return "\n\n".join(f"{name}:\n{sections[name]}".rstrip("\n") for name in SECTION_ORDER)
