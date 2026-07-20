#!/usr/bin/env python3
"""
extract_printer_config_options.py

Reads OrcaSlicer/src/slic3r/GUI/Tab.cpp and
         OrcaSlicer/src/libslic3r/PrintConfig.cpp
to produce frontend/public/data/printer_config_dialog_options.json.

The JSON schema is:
{
  "tabs": [
    {
      "id": "basic",
      "label": "Basic information",
      "sections": [
        {
          "label": "Printable space",
          "fields": [
            {
              "key": "printable_height",
              "label": "Printable height",
              "type": "float",          // float | int | bool | enum | string | gcode | color
              "unit": "mm",             // optional
              "options": [              // only for type=enum
                {"value": "klipper", "label": "Klipper"}, ...
              ],
              "default": "250",         // optional
              "full_width": false       // true for gcode / textarea fields
            },
            ...
          ]
        },
        ...
      ]
    },
    ...
  ]
}

Usage:
  python3 scripts/extract_printer_config_options.py [--orca-root PATH]

Defaults:
  --orca-root  ../OrcaSlicer   (relative to this script's location)
"""

import argparse
import json
import re
import sys
from pathlib import Path


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--orca-root",
        default=None,
        help="Path to OrcaSlicer source root (default: ../../OrcaSlicer relative to script)",
    )
    p.add_argument(
        "--out",
        default=None,
        help="Output JSON path (default: ../frontend/public/data/printer_config_dialog_options.json)",
    )
    return p.parse_args()


# ---------------------------------------------------------------------------
# Step 1: Parse PrintConfig.cpp → dict[key → option_meta]
# ---------------------------------------------------------------------------

COTYPE_TO_FIELD_TYPE = {
    "coFloat":         "float",
    "coFloats":        "float",
    "coInt":           "int",
    "coInts":          "int",
    "coBool":          "bool",
    "coBools":         "bool",
    "coString":        "string",
    "coStrings":       "string",
    "coPercent":       "float",
    "coPercents":      "float",
    "coEnum":          "enum",
    "coEnums":         "enum",
    "coEnumsGeneric":  "enum",
    "coPoint":         "point",   # Vec2d — rendered as "x, y"
    "coPoints":        "point",
    "coPointsGroups":  "string",  # complex — render as plain text
}

_L_PATTERN = re.compile(r'L\("([^"\\]*(?:\\.[^"\\]*)*)"\)')

def strip_L(s: str) -> str:
    """Remove L("...") wrapper → plain string, also strips trailing C++ comments."""
    s = s.strip()
    # Remove trailing C++ line comment:  // ...
    s = re.sub(r'\s*//.*$', '', s).strip()
    # Unwrap L("...") or u8"..." or plain "..."
    m = _L_PATTERN.match(s)
    if m:
        return m.group(1)
    # u8"..." (raw degree symbol etc.)
    m = re.match(r'u8"([^"]*)"', s)
    if m:
        return m.group(1)
    return s.strip('"').strip("'")


def parse_print_config(path: Path) -> dict:
    """
    Return a dict keyed by option name with:
        label, full_label, tooltip, type, sidetext,
        enum_values: list[str], enum_labels: list[str], default: str
    """
    text = path.read_text(encoding="utf-8", errors="replace")
    lines = text.splitlines()

    options: dict = {}
    current_key: str | None = None

    # Regexes
    re_add   = re.compile(r'def\s*=\s*this->add\("([^"]+)",\s*(\w+)\)')
    re_label = re.compile(r'def->(?:full_)?label\s*=\s*(.+)')
    re_full_label = re.compile(r'def->full_label\s*=\s*(.+)')
    re_side  = re.compile(r'def->sidetext\s*=\s*(.+)')
    # enum_values: push_back or emplace_back
    re_enum_val = re.compile(r'def->enum_values\.(?:push|emplace)_back\("([^"]+)"\)')
    re_enum_lab = re.compile(r'def->enum_labels\.push_back\((.+)\)')
    # More precise: extract the string literal inside L("...") directly — push_back or emplace_back
    re_enum_lab_L   = re.compile(r'def->enum_labels\.(?:push|emplace)_back\(\s*L\("([^"]+)"\)\s*\)')
    re_enum_lab_raw = re.compile(r'def->enum_labels\.(?:push|emplace)_back\("([^"]+)"\)')
    re_default  = re.compile(r'def->set_default_value\(new\s+[\w<>, ]+\s*[({]\s*([^{}\n)]*)')

    for line in lines:
        line = line.strip()

        m = re_add.search(line)
        if m:
            current_key = m.group(1)
            cotype = m.group(2)
            options[current_key] = {
                "type": COTYPE_TO_FIELD_TYPE.get(cotype, "string"),
                "label": "",
                "full_label": "",
                "tooltip": "",
                "unit": "",
                "enum_values": [],
                "enum_labels": [],
                "default": "",
            }
            continue

        if current_key is None:
            continue
        opt = options[current_key]

        m = re_full_label.search(line)
        if m:
            opt["full_label"] = strip_L(m.group(1).rstrip(";"))
            continue

        m = re_label.search(line)
        if m and "full_label" not in line:
            # only set label if full_label not already set via this same line
            val = strip_L(m.group(1).rstrip(";"))
            if not opt["label"]:
                opt["label"] = val
            continue

        m = re_side.search(line)
        if m:
            raw = m.group(1).strip()
            # Strip trailing C++ line comment FIRST, then semicolons/whitespace
            raw = re.sub(r'\s*//.*$', '', raw).strip().rstrip(';').strip()
            # Handle L(u8"...") or u8"..." or L("...") or plain "..."
            m2 = re.match(r'L\(u8"([^"]+)"\)', raw)
            if m2:
                opt["unit"] = m2.group(1)
            elif raw.startswith('u8"') or raw.startswith("u8'"):
                opt["unit"] = raw[3:].strip('"\'')
            elif raw.startswith('"'):
                opt["unit"] = raw.strip('"')
            else:
                opt["unit"] = strip_L(raw)
            continue

        m = re_enum_val.search(line)
        if m:
            opt["enum_values"].append(m.group(1))
            continue

        m = re_enum_lab_L.search(line)
        if m:
            opt["enum_labels"].append(m.group(1))
            continue

        m = re_enum_lab_raw.search(line)
        if m:
            opt["enum_labels"].append(m.group(1))
            continue

        m = re_default.search(line)
        if m and not opt["default"]:
            raw = m.group(1).strip()
            # Remove trailing parens/braces/semicolons and whitespace
            raw = re.sub(r'[)};]+$', '', raw).strip()
            raw = raw.strip('"').strip("'")

            # Vec2d(x, y) — closing ) may be cut off by the capture regex
            vec_m = re.match(r'Vec2d\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)', raw)
            if vec_m:
                x = vec_m.group(1).rstrip('f').rstrip('.')
                y = vec_m.group(2).rstrip('f').rstrip('.')
                opt["default"] = f"{x}, {y}"
            elif '::' in raw:
                # Store the C++ enum identifier suffix for post-processing
                cpp_id = raw.split('::')[-1].strip().rstrip(')')
                opt["_cpp_enum_default"] = cpp_id
                opt["default"] = ""
            elif raw.startswith('Vec2d') or raw.startswith('new '):
                opt["default"] = ""
            else:
                first = raw.split(',')[0].strip().strip('"')
                first = first.rstrip('f')
                first = re.sub(r'\.$', '', first)
                opt["default"] = first

    # Post-process: map C++ enum identifiers in defaults to their enum value string.
    for opt in options.values():
        if opt["type"] != "enum" or not opt["enum_values"]:
            opt.pop("_cpp_enum_default", None)
            continue

        # Case 1: default was a plain C++ identifier (no ::), e.g. "psUndefine"
        if opt["default"] and re.match(r'^[A-Za-z_]\w*$', opt["default"]) and opt["default"] not in ('true', 'false'):
            d_lower = opt["default"].lower()
            matched = next((ev for ev in opt["enum_values"]
                            if ev.lower() == d_lower or ev.lower().replace('-', '').replace('_', '') == d_lower.replace('_', '')), None)
            opt["default"] = matched if matched else opt["enum_values"][0]

        # Case 2: default was a ::ScopedEnumValue, stored in _cpp_enum_default
        elif not opt["default"] and opt.get("_cpp_enum_default"):
            cpp_id = opt["_cpp_enum_default"].lower().replace('_', '')
            # Try suffix match against enum values (e.g. "Type2" → "type2")
            matched = next((ev for ev in opt["enum_values"]
                            if ev.lower().replace('-', '').replace('_', '') == cpp_id
                            or cpp_id.endswith(ev.lower().replace('-', '').replace('_', ''))), None)
            opt["default"] = matched if matched else opt["enum_values"][0]

        opt.pop("_cpp_enum_default", None)

    # Prefer full_label as label when available
    for opt in options.values():
        opt.pop("_cpp_enum_default", None)  # cleanup any stragglers
        if opt["full_label"]:
            opt["label"] = opt["full_label"]
        del opt["full_label"]

    return options


# ---------------------------------------------------------------------------
# Step 2: Parse Tab.cpp → ordered list of (tab, section, key) tuples
#          covering only TabPrinter::build_fff, build_kinematics_page,
#          build_unregular_pages
# ---------------------------------------------------------------------------

# Keys we want to capture that appear as multi-field "line" constructs
# (append_line with two options on one row)
PAIR_LINES = {
    "fan_speedup_time": "fan_speedup_overhangs",           # fan speed-up + Only overhangs checkbox
    "input_shaping_freq_x": "input_shaping_freq_y",
    "input_shaping_damp_x": "input_shaping_damp_y",
    "min_resonance_avoidance_speed": "max_resonance_avoidance_speed",
}

# Gcode keys that should render as a textarea
GCODE_KEYS = {
    "file_start_gcode",
    "machine_start_gcode",
    "machine_end_gcode",
    "printing_by_object_gcode",
    "before_layer_change_gcode",
    "layer_change_gcode",
    "time_lapse_gcode",
    "wrapping_detection_gcode",
    "change_filament_gcode",
    "change_extrusion_role_gcode",
    "machine_pause_gcode",
    "template_custom_gcode",
    "printer_notes",
}

# Notes-tab key (textarea, not gcode)
NOTES_KEY = "printer_notes"


def parse_tab_cpp(path: Path) -> list:
    """
    Parse the three TabPrinter builder functions and return the schema as:
    [
      {"id": ..., "label": ..., "sections": [
          {"label": ..., "fields": [key, ...]}, ...
      ]}, ...
    ]
    Keys appear in source order.  Duplicates within a section are skipped.
    """
    text = path.read_text(encoding="utf-8", errors="replace")

    # ── Strip block comments (/* ... */) and line comments (//) ──────────────
    # Remove /* ... */ first (non-greedy, dotall)
    text = re.sub(r'/\*.*?\*/', '', text, flags=re.DOTALL)
    # Remove // line comments
    text = re.sub(r'//[^\n]*', '', text)
    # Remove #if 0 ... #endif blocks (common in OrcaSlicer)
    text = re.sub(r'#if\s+0.*?#endif', '', text, flags=re.DOTALL)

    # Extract the three function bodies we care about
    fn_ranges = []
    for fn_name, fn_id in [
        ("build_fff", "build_fff"),
        ("build_kinematics_page", "kinematics"),
        ("build_unregular_pages", "unregular"),
    ]:
        pattern = rf"TabPrinter::{fn_name}\b"
        m = re.search(pattern, text)
        if not m:
            print(f"  WARNING: {fn_name} not found in Tab.cpp", file=sys.stderr)
            continue
        start = m.start()
        # Find end by counting braces from first {
        brace_pos = text.find("{", start)
        depth = 0
        pos = brace_pos
        while pos < len(text):
            if text[pos] == "{":
                depth += 1
            elif text[pos] == "}":
                depth -= 1
                if depth == 0:
                    fn_ranges.append((fn_id, text[start : pos + 1]))
                    break
            pos += 1

    # Regex patterns
    re_page    = re.compile(r'add_options_page\(L\("([^"]+)"\)')
    re_group   = re.compile(r'new_optgroup\(L\("([^"]+)"\)')
    re_option  = re.compile(r'append_single_option_line\("([^"]+)"')
    re_append_opt = re.compile(r'append_option_line\(\w+,\s*"([^"]+)"')  # motion ability loop
    re_get_opt = re.compile(r'get_option\("([^"]+)"')  # for append_line constructs

    # Tabs to completely skip (comment artifacts, SLA stubs, etc.)
    SKIP_TAB_LABELS = {"Dependencies", "Profile dependencies"}
    # Sections to skip
    SKIP_SECTION_LABELS = {"Profile dependencies", "Preview"}

    tabs: list = []

    # Tab id slugs derived from labels
    TAB_IDS = {
        "Basic information": "basic",
        "Machine G-code":    "gcode",
        "Notes":             "notes",
        "Motion ability":    "motion",
        "Multimaterial":     "multimaterial",
        # Extruder tab is dynamic — handled specially below
    }

    current_tab: dict | None = None
    current_section: dict | None = None

    def ensure_tab(label: str) -> dict | None:
        nonlocal current_tab, current_section
        if label in SKIP_TAB_LABELS:
            current_tab = None
            current_section = None
            return None
        tab_id = TAB_IDS.get(label, label.lower().replace(" ", "_"))
        for t in tabs:
            if t["id"] == tab_id:
                current_tab = t
                current_section = None
                return t
        t = {"id": tab_id, "label": label, "sections": []}
        tabs.append(t)
        current_tab = t
        current_section = None
        return t

    def ensure_section(label: str) -> dict | None:
        nonlocal current_section
        if current_tab is None or label in SKIP_SECTION_LABELS:
            current_section = None
            return None
        for s in current_tab["sections"]:
            if s["label"] == label:
                current_section = s
                return s
        s = {"label": label, "fields": []}
        current_tab["sections"].append(s)
        current_section = s
        return s

    def add_field(key: str):
        if current_section is None or not key:
            return
        if any(f["key"] == key for f in current_section["fields"]):
            return  # dedupe
        current_section["fields"].append({"key": key})

    # Internal pseudo-option keys to ignore
    SKIP_KEYS = {"extruders_count", "full_power_legend", "silent_legend"}

    for fn_id, body in fn_ranges:
        lines = body.splitlines()

        # For build_unregular_pages: detect the extruder page loop.
        # The loop uses `add_options_page(page_name, ...)` with a variable,
        # so we detect the comment-style marker instead.
        in_extruder_loop = False

        for line in lines:
            stripped = line.strip()

            # Detect start of extruder page loop (build_unregular_pages)
            if fn_id == "unregular" and (
                'add_options_page(page_name' in stripped
                or '"Extruder %d"' in stripped
                or 'wxString::Format("Extruder"' in stripped
            ):
                in_extruder_loop = True
                # Create / find the Extruder tab
                ensure_tab("Extruder")
                continue

            # Detect end of extruder page loop — once we see
            # "BBS. No extra extruder page" or the page erase block
            if in_extruder_loop and (
                'm_extruders_count_old' in stripped
                and 'extruder_idx' not in stripped
            ):
                in_extruder_loop = False

            # New tab page (only from string literals)
            m = re_page.search(stripped)
            if m:
                in_extruder_loop = False
                ensure_tab(m.group(1))
                continue

            # New optgroup / section
            m = re_group.search(stripped)
            if m and current_tab is not None:
                ensure_section(m.group(1))
                continue

            # Single option line
            m = re_option.search(stripped)
            if m:
                key = m.group(1)
                if key not in SKIP_KEYS:
                    add_field(key)
                    if key in PAIR_LINES:
                        add_field(PAIR_LINES[key])
                continue

            # append_option_line("key", ...) — used for motion ability speed/accel/jerk loops
            m = re_append_opt.search(stripped)
            if m:
                key = m.group(1)
                if key not in SKIP_KEYS:
                    add_field(key)
                continue

            # get_option("...") inside an append_line call (paired rows)
            for m in re_get_opt.finditer(stripped):
                key = m.group(1)
                if key not in SKIP_KEYS:
                    add_field(key)

    # Post-process: expand "machine_max_*_" stub keys generated by C++ concat loops
    # e.g. "machine_max_acceleration_" → x, y, z, e variants
    MOTION_AXES = ["x", "y", "z", "e"]
    MOTION_LOOP_PREFIXES = {
        "machine_max_speed_":        [f"machine_max_speed_{a}"        for a in MOTION_AXES],
        "machine_max_acceleration_": [f"machine_max_acceleration_{a}" for a in MOTION_AXES],
        "machine_max_jerk_":         [f"machine_max_jerk_{a}"         for a in MOTION_AXES],
    }
    # Speed limitation also uses a speed_axes vector literal in Tab.cpp; inject manually
    SPEED_FIELDS_EXPLICIT = [
        "machine_max_speed_x", "machine_max_speed_y",
        "machine_max_speed_z", "machine_max_speed_e",
    ]

    for tab in tabs:
        if tab["id"] != "motion":
            continue
        for sec in tab["sections"]:
            new_fields = []
            seen = set()
            for field in sec["fields"]:
                key = field["key"]
                if key in MOTION_LOOP_PREFIXES:
                    for expanded in MOTION_LOOP_PREFIXES[key]:
                        if expanded not in seen:
                            seen.add(expanded)
                            new_fields.append({"key": expanded})
                else:
                    if key not in seen:
                        seen.add(key)
                        new_fields.append(field)
            sec["fields"] = new_fields
            # Inject speed fields if section is still empty (from vector literal)
            if sec["label"] == "Speed limitation" and not sec["fields"]:
                sec["fields"] = [{"key": k} for k in SPEED_FIELDS_EXPLICIT]

    # Post-process: inject printable_area into Basic → Printable space
    # (it's rendered as a custom widget in Tab.cpp, not via append_single_option_line)
    for tab in tabs:
        if tab["id"] == "basic":
            for sec in tab["sections"]:
                if sec["label"] == "Printable space":
                    keys = [f["key"] for f in sec["fields"]]
                    if "printable_area" not in keys:
                        # Insert after parallel_printheads_count (first item) if present,
                        # otherwise at the front
                        idx = 1 if keys and keys[0] == "parallel_printheads_count" else 0
                        sec["fields"].insert(idx, {"key": "printable_area"})

    # Remove any tabs that ended up with no sections or only empty sections
    tabs = [
        t for t in tabs
        if any(len(s["fields"]) > 0 for s in t["sections"])
    ]

    # Enforce canonical tab order
    ORDER = ["basic", "gcode", "multimaterial", "extruder", "motion", "notes"]
    def tab_order(t):
        try:
            return ORDER.index(t["id"])
        except ValueError:
            return 99

    tabs.sort(key=tab_order)

    return tabs


# ---------------------------------------------------------------------------
# Step 3: Merge option metadata into the schema
# ---------------------------------------------------------------------------

def merge_metadata(tabs: list, options: dict) -> list:
    """
    Enrich each field dict with type, label, unit, options[], default
    from options (PrintConfig.cpp data).
    """
    for tab in tabs:
        for section in tab["sections"]:
            for field in section["fields"]:
                key = field["key"]
                meta = options.get(key, {})

                field_type = meta.get("type", "string")
                if key in GCODE_KEYS:
                    field_type = "gcode"

                field["type"]  = field_type
                field["label"] = meta.get("label") or key  # fallback to key name
                unit = meta.get("unit", "")
                if unit:
                    field["unit"] = unit
                if field_type == "enum":
                    vals   = meta.get("enum_values", [])
                    labels = meta.get("enum_labels", [])
                    # Pad labels to same length as values
                    while len(labels) < len(vals):
                        labels.append(vals[len(labels)])
                    field["options"] = [
                        {"value": v, "label": l}
                        for v, l in zip(vals, labels)
                    ]
                default = meta.get("default", "")
                if default:
                    field["default"] = default

    return tabs


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    args = parse_args()

    script_dir = Path(__file__).parent.resolve()
    repo_root  = script_dir.parent  # OrcaSlicerWebUI/

    if args.orca_root:
        orca_root = Path(args.orca_root).resolve()
    else:
        orca_root = (repo_root.parent / "OrcaSlicer").resolve()

    tab_cpp_path    = orca_root / "src" / "slic3r" / "GUI" / "Tab.cpp"
    config_cpp_path = orca_root / "src" / "libslic3r" / "PrintConfig.cpp"

    if not tab_cpp_path.exists():
        sys.exit(f"ERROR: Tab.cpp not found at {tab_cpp_path}")
    if not config_cpp_path.exists():
        sys.exit(f"ERROR: PrintConfig.cpp not found at {config_cpp_path}")

    if args.out:
        out_path = Path(args.out).resolve()
    else:
        out_path = repo_root / "frontend" / "public" / "data" / "printer_config_dialog_options.json"

    out_path.parent.mkdir(parents=True, exist_ok=True)

    print(f"Parsing PrintConfig.cpp …")
    options = parse_print_config(config_cpp_path)
    print(f"  → {len(options)} options parsed")

    print(f"Parsing Tab.cpp …")
    tabs = parse_tab_cpp(tab_cpp_path)
    total_fields = sum(len(f["fields"]) for t in tabs for f in t["sections"])
    print(f"  → {len(tabs)} tabs, {total_fields} fields")

    print(f"Merging metadata …")
    tabs = merge_metadata(tabs, options)

    result = {"tabs": tabs}
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    print(f"Written → {out_path}")
    print()
    for tab in tabs:
        n = sum(len(s["fields"]) for s in tab["sections"])
        print(f"  {tab['label']:<25} {len(tab['sections'])} sections, {n} fields")


if __name__ == "__main__":
    main()
