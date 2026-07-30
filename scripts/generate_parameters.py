#!/usr/bin/env python3
"""
Invoked during the `json-gen` Docker build stage to produce
data/parameters.json from a freshly checked-out OrcaSlicer source tree,
using the project's own ParameterParser class (scripts/parameter_parser.py).

Usage:
    python3 generate_parameters.py <orca-root> <output-json-path>
"""
import sys
from pathlib import Path

# In the Docker json-gen stage all scripts are copied to /gen/, so
# parameter_parser.py is a sibling of this file.
sys.path.insert(0, str(Path(__file__).parent))
from parameter_parser import ParameterParser  # noqa: E402


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit(f"Usage: {sys.argv[0]} <orca-root> <output-json-path>")

    orca_root, output_path = sys.argv[1], sys.argv[2]
    cpp_file = Path(orca_root) / "src" / "libslic3r" / "PrintConfig.cpp"

    parser = ParameterParser(str(cpp_file))
    parser.parse()
    parser.save_to_json(output_path)


if __name__ == "__main__":
    main()
