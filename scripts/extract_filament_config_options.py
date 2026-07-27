#!/usr/bin/env python3
"""
extract_filament_config_options.py

Reads OrcaSlicer/src/slic3r/GUI/Tab.cpp  (TabFilament::build)
and   OrcaSlicer/src/libslic3r/PrintConfig.cpp
to produce frontend/public/data/filament_config_dialog_options.json.

Same schema as printer_config_dialog_options.json.

Usage:
  python3 scripts/extract_filament_config_options.py [--orca-root PATH]
"""

import argparse, json, re, sys
from pathlib import Path


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--orca-root", default=None)
    p.add_argument("--out", default=None)
    return p.parse_args()


# ---------------------------------------------------------------------------
# Shared with printer script — type map, strip helpers, PrintConfig parser
# (duplicated here so the script is self-contained)
# ---------------------------------------------------------------------------

COTYPE_TO_FIELD_TYPE = {
    "coFloat": "float", "coFloats": "float",
    "coInt": "int",     "coInts": "int",
    "coBool": "bool",   "coBools": "bool",
    "coString": "string", "coStrings": "string",
    "coPercent": "float", "coPercents": "float",
    "coEnum": "enum",   "coEnums": "enum",  "coEnumsGeneric": "enum",
    "coPoint": "point", "coPoints": "point",
    "coPointsGroups": "string",
}

_L_PATTERN = re.compile(r'L\("([^"\\]*(?:\\.[^"\\]*)*)"\)')

def strip_L(s: str) -> str:
    s = s.strip()
    s = re.sub(r'\s*//.*$', '', s).strip()
    m = _L_PATTERN.match(s)
    if m: return _decode_cpp_string(m.group(1))
    m = re.match(r'u8"([^"]*)"', s)
    if m: return _decode_cpp_string(m.group(1))
    m = re.match(r'L\(\s*u8"([^"]*)"\s*\)', s)
    if m: return _decode_cpp_string(m.group(1))
    return s.strip('"').strip("'")


def _decode_cpp_string(s: str) -> str:
    """Decode C++ unicode escapes like \\u2103 → °C, only when escapes are present."""
    if '\\u' not in s and '\\U' not in s:
        return s
    try:
        return s.encode('utf-8').decode('unicode_escape').encode('latin-1').decode('utf-8')
    except Exception:
        try:
            return bytes(s, 'utf-8').decode('unicode_escape')
        except Exception:
            return s


def parse_print_config(path: Path) -> dict:
    text  = path.read_text(encoding="utf-8", errors="replace")
    # Strip block comments so L(u8"\u2103" /* °C */) patterns are cleaned first
    text  = re.sub(r'/\*.*?\*/', '', text, flags=re.DOTALL)
    lines = text.splitlines()
    options: dict = {}
    current_key = None

    re_add          = re.compile(r'def\s*=\s*this->add\("([^"]+)",\s*(\w+)\)')
    re_full_label   = re.compile(r'def->full_label\s*=\s*(.+)')
    re_label        = re.compile(r'def->label\s*=\s*(.+)')
    re_side         = re.compile(r'def->sidetext\s*=\s*(.+)')
    re_enum_val     = re.compile(r'def->enum_values\.(?:push|emplace)_back\("([^"]+)"\)')
    re_enum_lab_L   = re.compile(r'def->enum_labels\.(?:push|emplace)_back\(\s*L\("([^"]+)"\)\s*\)')
    re_enum_lab_raw = re.compile(r'def->enum_labels\.(?:push|emplace)_back\("([^"]+)"\)')
    re_default      = re.compile(r'def->set_default_value\(new\s+[\w<>, ]+\s*[({]\s*([^{}\n)]*)')

    for line in lines:
        line = line.strip()

        m = re_add.search(line)
        if m:
            current_key = m.group(1)
            options[current_key] = {
                "type": COTYPE_TO_FIELD_TYPE.get(m.group(2), "string"),
                "label": "", "full_label": "", "unit": "",
                "enum_values": [], "enum_labels": [], "default": "",
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
            if not opt["label"]:
                opt["label"] = strip_L(m.group(1).rstrip(";"))
            continue

        m = re_side.search(line)
        if m:
            raw = re.sub(r'\s*//.*$', '', m.group(1).strip()).rstrip(';').strip()
            m2 = re.match(r'L\(\s*u8"([^"]+)"\s*\)', raw)
            if m2:         opt["unit"] = _decode_cpp_string(m2.group(1))
            elif raw.startswith('u8"'): opt["unit"] = _decode_cpp_string(raw[3:].strip('"'))
            elif raw.startswith('"'):   opt["unit"] = raw.strip('"')
            else:                       opt["unit"] = strip_L(raw)
            continue

        m = re_enum_val.search(line)
        if m:
            opt["enum_values"].append(m.group(1)); continue

        m = re_enum_lab_L.search(line)
        if m:
            opt["enum_labels"].append(m.group(1)); continue

        m = re_enum_lab_raw.search(line)
        if m:
            opt["enum_labels"].append(m.group(1)); continue

        m = re_default.search(line)
        if m and not opt["default"]:
            raw = re.sub(r'[)};]+$', '', m.group(1).strip()).strip().strip('"').strip("'")
            vec = re.match(r'Vec2d\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)', raw)
            if vec:
                opt["default"] = f"{vec.group(1).rstrip('f.')}, {vec.group(2).rstrip('f.')}"
            elif '::' in raw:
                opt["_cpp_enum_default"] = raw.split('::')[-1].strip().rstrip(')')
            elif not raw.startswith('Vec2d') and not raw.startswith('new '):
                first = raw.split(',')[0].strip().strip('"').rstrip('f')
                opt["default"] = re.sub(r'\.$', '', first)

    # Post-process enums
    for opt in options.values():
        if opt["type"] != "enum" or not opt["enum_values"]:
            opt.pop("_cpp_enum_default", None); continue
        if opt["default"] and re.match(r'^[A-Za-z_]\w*$', opt["default"]) and opt["default"] not in ('true','false'):
            dl = opt["default"].lower()
            matched = next((ev for ev in opt["enum_values"]
                            if ev.lower().replace('-','').replace('_','') == dl.replace('_','')), None)
            opt["default"] = matched or opt["enum_values"][0]
        elif not opt["default"] and opt.get("_cpp_enum_default"):
            cid = opt["_cpp_enum_default"].lower().replace('_','')
            matched = next((ev for ev in opt["enum_values"]
                            if ev.lower().replace('-','').replace('_','') == cid
                            or cid.endswith(ev.lower().replace('-','').replace('_',''))), None)
            opt["default"] = matched or opt["enum_values"][0]
        opt.pop("_cpp_enum_default", None)

    for opt in options.values():
        opt.pop("_cpp_enum_default", None)
        if opt.get("full_label"): opt["label"] = opt["full_label"]
        opt.pop("full_label", None)

    return options


# ---------------------------------------------------------------------------
# Filament-specific gcode keys
# ---------------------------------------------------------------------------

GCODE_KEYS = {
    "filament_start_gcode",
    "filament_end_gcode",
    "filament_change_extrusion_role_gcode",
    "filament_notes",
}

# Paired rows in the filament UI (primary → secondary key)
PAIR_LINES: dict[str, str] = {
    "nozzle_temperature_initial_layer":        "nozzle_temperature",
    "nozzle_temperature_range_low":            "nozzle_temperature_range_high",
    "supertack_plate_temp_initial_layer":      "supertack_plate_temp",
    "cool_plate_temp_initial_layer":           "cool_plate_temp",
    "textured_cool_plate_temp_initial_layer":  "textured_cool_plate_temp",
    "eng_plate_temp_initial_layer":            "eng_plate_temp",
    "hot_plate_temp_initial_layer":            "hot_plate_temp",
    "textured_plate_temp_initial_layer":       "textured_plate_temp",
    "fan_min_speed":                           "fan_cooling_layer_time",
    "fan_max_speed":                           "slow_down_layer_time",
    "chamber_temperature":                     "chamber_minimal_temperature",
    "activate_air_filtration_during_print":    "during_print_exhaust_fan_speed",
    "activate_air_filtration_on_completion":   "complete_print_exhaust_fan_speed",
}

# ---------------------------------------------------------------------------
# Parse TabFilament::build from Tab.cpp
# ---------------------------------------------------------------------------

SKIP_TAB_LABELS    = {"Dependencies"}
SKIP_SECTION_LABELS: set[str] = set()

TAB_IDS = {
    "Filament":       "filament",
    "Cooling":        "cooling",
    "Advanced":       "advanced",
    "Multimaterial":  "multimaterial",
    "Notes":          "notes",
}


def parse_filament_tab(path: Path) -> list:
    text = path.read_text(encoding="utf-8", errors="replace")
    # Strip comments / dead blocks
    text = re.sub(r'/\*.*?\*/', '', text, flags=re.DOTALL)
    text = re.sub(r'//[^\n]*', '', text)
    text = re.sub(r'#if\s+0.*?#endif', '', text, flags=re.DOTALL)

    # Extract TabFilament::build() body
    m = re.search(r'TabFilament::build\b', text)
    if not m:
        print("ERROR: TabFilament::build not found in Tab.cpp", file=sys.stderr)
        sys.exit(1)

    start     = m.start()
    brace_pos = text.find("{", start)
    depth, pos = 0, brace_pos
    while pos < len(text):
        if text[pos] == '{': depth += 1
        elif text[pos] == '}':
            depth -= 1
            if depth == 0:
                body = text[start : pos + 1]
                break
        pos += 1
    else:
        print("ERROR: Could not find end of TabFilament::build", file=sys.stderr)
        sys.exit(1)

    re_page      = re.compile(r'add_options_page\(L\("([^"]+)"\)')
    re_group     = re.compile(r'new_optgroup\(L\("([^"]+)"\)')
    re_option    = re.compile(r'append_single_option_line\("([^"]+)"')
    re_get_opt   = re.compile(r'get_option\("([^"]+)"')

    SKIP_KEYS = {"compatible_printers_condition", "compatible_prints_condition",
                 "compatible_printers", "compatible_prints", "filament_ramming_parameters"}

    tabs: list            = []
    current_tab: dict | None    = None
    current_section: dict | None = None

    def ensure_tab(label: str) -> dict | None:
        nonlocal current_tab, current_section
        if label in SKIP_TAB_LABELS:
            current_tab = current_section = None
            return None
        tab_id = TAB_IDS.get(label, label.lower().replace(" ", "_"))
        for t in tabs:
            if t["id"] == tab_id:
                current_tab = t; current_section = None; return t
        t = {"id": tab_id, "label": label, "sections": []}
        tabs.append(t); current_tab = t; current_section = None
        return t

    def ensure_section(label: str) -> dict | None:
        nonlocal current_section
        if current_tab is None or label in SKIP_SECTION_LABELS:
            current_section = None; return None
        for s in current_tab["sections"]:
            if s["label"] == label:
                current_section = s; return s
        s = {"label": label, "fields": []}
        current_tab["sections"].append(s); current_section = s
        return s

    def add_field(key: str):
        if current_section is None or not key or key in SKIP_KEYS: return
        if any(f["key"] == key for f in current_section["fields"]): return
        current_section["fields"].append({"key": key})

    PAIRED_SECONDARY = set(PAIR_LINES.values())

    for line in body.splitlines():
        stripped = line.strip()

        mp = re_page.search(stripped)
        if mp:
            ensure_tab(mp.group(1)); continue

        mg = re_group.search(stripped)
        if mg and current_tab is not None:
            ensure_section(mg.group(1)); continue

        mo = re_option.search(stripped)
        if mo:
            key = mo.group(1)
            add_field(key)
            if key in PAIR_LINES: add_field(PAIR_LINES[key])
            continue

        # append_line get_option pairs (bed temp rows, fan rows, etc.)
        for mg2 in re_get_opt.finditer(stripped):
            add_field(mg2.group(1))

    # Tidy: remove empty tabs/sections
    tabs = [t for t in tabs if any(len(s["fields"]) > 0 for s in t["sections"])]

    # Canonical order
    ORDER = ["filament", "cooling", "advanced", "multimaterial", "notes"]
    tabs.sort(key=lambda t: ORDER.index(t["id"]) if t["id"] in ORDER else 99)

    return tabs


# ---------------------------------------------------------------------------
# Merge metadata into schema
# ---------------------------------------------------------------------------

def merge_metadata(tabs: list, options: dict) -> list:
    for tab in tabs:
        for section in tab["sections"]:
            for field in section["fields"]:
                key  = field["key"]
                meta = options.get(key, {})
                ftype = meta.get("type", "string")
                if key in GCODE_KEYS: ftype = "gcode"
                field["type"]  = ftype
                field["label"] = meta.get("label") or key
                unit = meta.get("unit", "")
                if unit: field["unit"] = unit
                if ftype == "enum":
                    vals   = meta.get("enum_values", [])
                    labels = meta.get("enum_labels", [])
                    while len(labels) < len(vals): labels.append(vals[len(labels)])
                    field["options"] = [{"value": v, "label": l} for v, l in zip(vals, labels)]
                d = meta.get("default", "")
                if d: field["default"] = d
    return tabs


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    args      = parse_args()
    script_dir = Path(__file__).parent.resolve()
    repo_root  = script_dir.parent

    orca_root = Path(args.orca_root).resolve() if args.orca_root else (repo_root.parent / "OrcaSlicer").resolve()
    tab_cpp   = orca_root / "src" / "slic3r" / "GUI" / "Tab.cpp"
    cfg_cpp   = orca_root / "src" / "libslic3r" / "PrintConfig.cpp"

    for p in [tab_cpp, cfg_cpp]:
        if not p.exists():
            sys.exit(f"ERROR: {p} not found")

    out_path = Path(args.out).resolve() if args.out else \
        repo_root / "data" / "filament_config_dialog_options.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)

    print("Parsing PrintConfig.cpp …")
    options = parse_print_config(cfg_cpp)
    print(f"  → {len(options)} options")

    print("Parsing Tab.cpp (TabFilament::build) …")
    tabs = parse_filament_tab(tab_cpp)

    print("Merging metadata …")
    tabs = merge_metadata(tabs, options)

    result = {"tabs": tabs}
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    total = sum(len(s["fields"]) for t in tabs for s in t["sections"])
    print(f"Written → {out_path}  ({len(tabs)} tabs, {total} fields)")
    for tab in tabs:
        n = sum(len(s["fields"]) for s in tab["sections"])
        print(f"  {tab['label']:<35} {len(tab['sections'])} sections, {n} fields")


if __name__ == "__main__":
    main()
