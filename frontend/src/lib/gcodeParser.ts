/**
 * gcodeParser
 *
 * Parses an OrcaSlicer-generated .gcode file for the Preview tab: per-line-
 * type ("Line Type") statistics table (Time / Filament / Usage %, matching
 * the reference screenshot's Line Type / Time / Usage columns) and per-
 * layer toolpath segments for the 3D preview + layer/step scrubbers.
 *
 * Ported from native OrcaSlicer sources (read directly, not guessed):
 *  - `ExtrusionEntity::role_to_string` (libslic3r/ExtrusionEntity.cpp) for
 *    the exact display name of each line type ("Inner wall", "Outer wall",
 *    "Sparse infill", etc).
 *  - `DEFAULT_EXTRUSION_ROLES_COLORS` (libvgcode/src/ViewerImpl.cpp),
 *    indexed by `EGCodeExtrusionRole` (libvgcode/include/Types.hpp), for
 *    the exact RGB color swatch per line type shown in both the stats
 *    table and the 3D toolpath.
 *  - `GCodeProcessor::Reserved_Tags_compatible` (libslic3r/GCode/
 *    GCodeProcessor.cpp) for the exact gcode comment tags emitted by the
 *    CLI and consumed here: `;TYPE:<role>`, `;WIDTH:<mm>`, `;HEIGHT:<mm>`,
 *    `;LAYER_CHANGE`, `;Z:<mm>`.
 *  - The footer comment block the CLI appends after
 *    `; EXECUTABLE_BLOCK_END` (`; filament used [mm] = ...`,
 *    `; total filament used [g] = ...`, `; total filament cost = ...`,
 *    `; total layers count = ...`, `; estimated printing time (normal
 *    mode) = ...`, `; estimated first layer printing time (normal mode)
 *    = ...`) for the "Total estimation" panel — these are native's own
 *    already-computed values, not re-derived here, so they match exactly.
 *
 * What is NOT ported exactly (and why): native's per-line-type Time/%
 * breakdown comes from `libvgcode`'s full kinematic simulation (junction
 * deviation, per-axis jerk/acceleration limits, look-ahead cornering
 * speed). Reimplementing that whole planner is out of scope here — instead
 * each move's duration is approximated as `distance / feedrate` (the
 * `F` value active for that move, mm/min), which is exact for long
 * constant-velocity moves and only approximate for short accelerating
 * segments (typical for perimeters/infill at low layer height). Total
 * filament length per line type IS exact, since it's a direct sum of the
 * gcode's own E-axis deltas (the same values the CLI used to print).
 */

export interface LineTypeStat {
  /** Native display name, e.g. "Inner wall", "Sparse infill". */
  role: string;
  /** RGB color (0-255 each), matching native's DEFAULT_EXTRUSION_ROLES_COLORS. */
  color: [number, number, number];
  /** Approximate print time for this line type, in seconds. */
  timeSeconds: number;
  /** Extruded filament length for this line type, in mm (exact, from E deltas). */
  filamentMm: number;
  /** Extruded filament weight for this line type, in g (derived from filamentMm). */
  filamentGrams: number;
  /** Fraction of total time (0-1) this line type accounts for. */
  usageFraction: number;
}

export interface TravelStat {
  timeSeconds: number;
  usageFraction: number;
  /** Total travel distance, in mm. */
  distanceMm: number;
  /** Number of travel moves. */
  moveCount: number;
}

export interface TotalEstimation {
  /** Total filament length across all extruders, in meters (native's own value). */
  totalFilamentM: number | null;
  /** Model filament length (same as total for single-extruder plates), in meters. */
  modelFilamentM: number | null;
  totalFilamentG: number | null;
  cost: number | null;
  /** Native reports this as "prepare time" — approximated here as the
   * first-layer printing time, matching what's actually available in the
   * gcode footer comments. */
  prepareTimeSeconds: number | null;
  modelPrintingTimeSeconds: number | null;
  totalTimeSeconds: number | null;
  totalLayers: number | null;
}

/** A single toolpath segment (one gcode move), in bed-plane mm coordinates
 * with Z as the print height, ready to feed into a Three.js LineSegments
 * buffer. `isExtrusion` is false for travel moves (no E delta). */
export interface ToolpathSegment {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
  role: string;
  isExtrusion: boolean;
  layerIndex: number;
}

export interface LayerInfo {
  /** Index into `segments` of this layer's first segment. */
  startSegmentIndex: number;
  /** Index into `segments` one past this layer's last segment (exclusive). */
  endSegmentIndex: number;
  /** Print height (Z, mm) at the top of this layer. */
  z: number;
  /** This layer's height (mm), from the `;HEIGHT:` tag. */
  height: number;
}

export interface ParsedGcode {
  lineTypeStats: LineTypeStat[];
  travelStat: TravelStat;
  totalEstimation: TotalEstimation;
  segments: ToolpathSegment[];
  layers: LayerInfo[];
}

/**
 * Native's `ExtrusionEntity::role_to_string` (ExtrusionEntity.cpp), mapping
 * every `;TYPE:` tag value the CLI can emit to itself (the tag value IS
 * the display name already) plus the "Travel" pseudo-role used for
 * non-extruding moves. Kept as an explicit allowlist (rather than trusting
 * arbitrary tag text) so unrecognized/future tags fall back to a stable
 * "Custom" bucket instead of fragmenting the stats table.
 */
const KNOWN_ROLES = new Set([
  'Undefined',
  'Inner wall',
  'Outer wall',
  'Overhang wall',
  'Sparse infill',
  'Internal solid infill',
  'Top surface',
  'Bottom surface',
  'Ironing',
  'Bridge',
  'Internal Bridge',
  'Gap infill',
  'Skirt',
  'Brim',
  'Support',
  'Support interface',
  'Support transition',
  'Prime tower',
  'Custom',
  'Multiple',
]);

/**
 * Native's `DEFAULT_EXTRUSION_ROLES_COLORS` (libvgcode/src/ViewerImpl.cpp),
 * indexed by `EGCodeExtrusionRole` (libvgcode/include/Types.hpp) and
 * re-keyed here by the display name from `role_to_string` so the parser
 * can look colors up directly by the `;TYPE:` tag value.
 */
export const LINE_TYPE_COLORS: Record<string, [number, number, number]> = {
  Undefined: [230, 179, 179],
  'Inner wall': [255, 230, 77],
  'Outer wall': [255, 125, 56],
  'Overhang wall': [31, 31, 255],
  'Sparse infill': [176, 48, 41],
  'Internal solid infill': [150, 84, 204],
  'Top surface': [240, 64, 64],
  Ironing: [255, 140, 105],
  Bridge: [77, 128, 186],
  'Internal Bridge': [77, 128, 186],
  'Gap infill': [255, 255, 255],
  Skirt: [0, 135, 110],
  Support: [0, 255, 0],
  'Support interface': [0, 128, 0],
  'Prime tower': [179, 227, 171],
  Custom: [94, 209, 148],
  'Bottom surface': [102, 92, 199],
  Brim: [0, 59, 110],
  'Support transition': [0, 64, 0],
  Multiple: [128, 128, 128],
  // Not a real extrusion role (no ;TYPE: tag) — native's Travel row uses
  // EOptionType::Travels' color (DEFAULT_OPTIONS_COLORS[0] in the same
  // source file) rather than an extrusion-role color.
  Travel: [56, 72, 155],
};

/** Filament cross-section area (mm^2) for a given filament diameter (mm),
 * used to convert extruded length (from E deltas) to volume, then to
 * weight via density. Matches the simple cylindrical-filament assumption
 * native's `get_used_filament_from_volume` also relies on. */
function filamentCrossSectionAreaMm2(diameterMm: number): number {
  const r = diameterMm / 2;
  return Math.PI * r * r;
}

/**
 * Parse a footer "; key = value" comment line into a numeric value,
 * matching the gcode CLI's config-dump format (e.g. "; filament_density
 * = 1.24" or "; nozzle_diameter = 0.4"). Returns null if the line doesn't
 * match or the value isn't numeric.
 */
function parseConfigNumber(line: string, key: string): number | null {
  const match = line.match(new RegExp(`^;\\s*${key}\\s*=\\s*([\\d.eE+-]+)`));
  if (!match) return null;
  const value = parseFloat(match[1]);
  return Number.isFinite(value) ? value : null;
}

/** Parse "27m 7s" / "2h 3m 10s" / "45s" style durations from the CLI's
 * footer comments (`; estimated printing time (normal mode) = 27m 7s`)
 * into whole seconds. */
function parseDurationToSeconds(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  let total = 0;
  let matched = false;
  const re = /(\d+)\s*([hms])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(trimmed)) !== null) {
    matched = true;
    const value = parseInt(m[1], 10);
    const unit = m[2];
    if (unit === 'h') total += value * 3600;
    else if (unit === 'm') total += value * 60;
    else total += value;
  }
  return matched ? total : null;
}

/**
 * Parse the value out of a gcode axis/parameter token like "X12.5" or
 * "E.64218" (note: OrcaSlicer's CLI frequently omits the leading "0" on
 * fractional values, e.g. ".64218" instead of "0.64218" — `parseFloat`
 * handles that natively).
 */
function parseAxisToken(token: string): number {
  return parseFloat(token.slice(1));
}

/**
 * Parse a complete .gcode file (as text) into line-type statistics, travel
 * stats, total estimation figures, and per-layer toolpath segments.
 */
export function parseGcode(text: string): ParsedGcode {
  const lines = text.split('\n');

  // Per-role accumulators for the stats table.
  const roleFilamentMm = new Map<string, number>();
  const roleTimeSeconds = new Map<string, number>();
  let travelTimeSeconds = 0;
  let travelDistanceMm = 0;
  let travelMoveCount = 0;

  const segments: ToolpathSegment[] = [];
  const layers: LayerInfo[] = [];

  // Absolute machine state. OrcaSlicer's CLI output uses absolute X/Y/Z
  // positioning (G90, the default) and relative E distances (M83, seen in
  // the sample output's "use relative distances for extrusion" comment) —
  // handle both relative and absolute E defensively since some profiles
  // may emit M82 (absolute E) instead.
  let x = 0;
  let y = 0;
  let z = 0;
  let e = 0;
  let relativeE = true;
  let relativeXYZ = false;
  let feedrateMmPerMin = 0; // last seen F value
  let currentRole = 'Undefined';
  let currentLayerIndex = -1;
  let currentLayerHeight = 0;
  let currentLayerStartSegment = 0;
  let sawAnyLayerChange = false;

  const addFilament = (role: string, deltaMm: number) => {
    roleFilamentMm.set(role, (roleFilamentMm.get(role) ?? 0) + deltaMm);
  };
  const addTime = (role: string, seconds: number) => {
    roleTimeSeconds.set(role, (roleTimeSeconds.get(role) ?? 0) + seconds);
  };

  const closeCurrentLayer = (endSegmentIndex: number) => {
    if (currentLayerIndex < 0) return;
    layers.push({
      startSegmentIndex: currentLayerStartSegment,
      endSegmentIndex,
      z,
      height: currentLayerHeight,
    });
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) continue;

    if (line.startsWith(';')) {
      // Reserved tag comments (GCodeProcessor::Reserved_Tags_compatible).
      if (line.startsWith(';TYPE:')) {
        const role = line.slice(6).trim();
        currentRole = KNOWN_ROLES.has(role) ? role : 'Custom';
      } else if (line.startsWith(';LAYER_CHANGE')) {
        closeCurrentLayer(segments.length);
        currentLayerIndex += 1;
        currentLayerStartSegment = segments.length;
        sawAnyLayerChange = true;
      } else if (line.startsWith(';HEIGHT:')) {
        const h = parseFloat(line.slice(8).trim());
        if (Number.isFinite(h)) currentLayerHeight = h;
      } else if (line.startsWith(';Z:')) {
        const zTag = parseFloat(line.slice(3).trim());
        if (Number.isFinite(zTag)) z = zTag;
      }
      continue;
    }

    // Strip trailing inline comments (e.g. "M83 ; use relative ...").
    const codeOnly = line.split(';')[0].trim();
    if (codeOnly.length === 0) continue;

    const tokens = codeOnly.split(/\s+/);
    const cmd = tokens[0].toUpperCase();

    if (cmd === 'G90') {
      relativeXYZ = false;
      continue;
    }
    if (cmd === 'G91') {
      relativeXYZ = true;
      continue;
    }
    if (cmd === 'M82') {
      relativeE = false;
      continue;
    }
    if (cmd === 'M83') {
      relativeE = true;
      continue;
    }
    if (cmd === 'G92') {
      // Reset axis position(s) without moving — most commonly "G92 E0".
      for (const tok of tokens.slice(1)) {
        const axis = tok[0]?.toUpperCase();
        const value = parseAxisToken(tok);
        if (!Number.isFinite(value)) continue;
        if (axis === 'E') e = value;
        else if (axis === 'X') x = value;
        else if (axis === 'Y') y = value;
        else if (axis === 'Z') z = value;
      }
      continue;
    }

    if (cmd !== 'G0' && cmd !== 'G1') continue;

    const x0 = x;
    const y0 = y;
    const z0 = z;
    let hasXY = false;
    let deltaE = 0;
    let hasE = false;

    for (const tok of tokens.slice(1)) {
      const axis = tok[0]?.toUpperCase();
      const value = parseAxisToken(tok);
      if (!Number.isFinite(value)) continue;

      switch (axis) {
        case 'X':
          x = relativeXYZ ? x + value : value;
          hasXY = true;
          break;
        case 'Y':
          y = relativeXYZ ? y + value : value;
          hasXY = true;
          break;
        case 'Z':
          z = relativeXYZ ? z + value : value;
          break;
        case 'E':
          hasE = true;
          if (relativeE) {
            deltaE = value;
            e += value;
          } else {
            deltaE = value - e;
            e = value;
          }
          break;
        case 'F':
          feedrateMmPerMin = value;
          break;
        default:
          break;
      }
    }

    const dx = x - x0;
    const dy = y - y0;
    const dz = z - z0;
    const distanceMm = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (distanceMm === 0) continue;

    const feedrateMmPerSec = feedrateMmPerMin > 0 ? feedrateMmPerMin / 60 : 0;
    const durationSeconds = feedrateMmPerSec > 0 ? distanceMm / feedrateMmPerSec : 0;

    // Positive E delta with actual XY movement = an extrusion move.
    // (Retract/unretract/wipe E-only moves have hasXY === false and are
    // not counted as line-type extrusion, matching native excluding them
    // from the per-role filament figures.)
    const isExtrusion = hasE && deltaE > 0 && hasXY;

    if (isExtrusion) {
      addFilament(currentRole, deltaE);
      addTime(currentRole, durationSeconds);
    } else if (hasXY && !isExtrusion) {
      travelDistanceMm += distanceMm;
      travelMoveCount += 1;
      travelTimeSeconds += durationSeconds;
    }

    segments.push({
      x0,
      y0,
      z0,
      x1: x,
      y1: y,
      z1: z,
      role: isExtrusion ? currentRole : 'Travel',
      isExtrusion,
      layerIndex: Math.max(currentLayerIndex, 0),
    });
  }

  // Close the final layer (no trailing ;LAYER_CHANGE tag after the last one).
  if (sawAnyLayerChange) {
    closeCurrentLayer(segments.length);
  } else if (segments.length > 0) {
    // Degenerate/no layer tags found at all — treat the whole file as one layer.
    layers.push({ startSegmentIndex: 0, endSegmentIndex: segments.length, z, height: currentLayerHeight });
  }

  // ---- Footer "Total estimation" values (native's own computed figures) ----
  let totalFilamentMm: number | null = null;
  let totalFilamentG: number | null = null;
  let cost: number | null = null;
  let totalLayers: number | null = null;
  let printTimeSeconds: number | null = null;
  let firstLayerTimeSeconds: number | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line.startsWith(';')) continue;

    let m = line.match(/^;\s*filament used \[mm\]\s*=\s*([\d.eE+-]+)/);
    if (m) {
      totalFilamentMm = parseFloat(m[1]);
      continue;
    }
    m = line.match(/^;\s*total filament used \[g\]\s*=\s*([\d.eE+-]+)/);
    if (m) {
      totalFilamentG = parseFloat(m[1]);
      continue;
    }
    m = line.match(/^;\s*total filament cost\s*=\s*([\d.eE+-]+)/);
    if (m) {
      cost = parseFloat(m[1]);
      continue;
    }
    m = line.match(/^;\s*total layers count\s*=\s*([\d.eE+-]+)/);
    if (m) {
      totalLayers = parseInt(m[1], 10);
      continue;
    }
    m = line.match(/^;\s*estimated printing time \([^)]*\)\s*=\s*(.+)$/);
    if (m) {
      printTimeSeconds = parseDurationToSeconds(m[1]);
      continue;
    }
    m = line.match(/^;\s*estimated first layer printing time \([^)]*\)\s*=\s*(.+)$/);
    if (m) {
      firstLayerTimeSeconds = parseDurationToSeconds(m[1]);
      continue;
    }
  }

  // Filament weight per role, derived from length via cross-section area x
  // density — using the same filament_diameter/filament_density values the
  // CLI itself printed into the config-dump footer, so results reconcile
  // with the file's own totals rather than an arbitrary assumed diameter.
  let filamentDiameterMm = 1.75;
  let filamentDensityGPerCm3 = 1.24; // PLA-typical fallback if not found
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const diameter = parseConfigNumber(line, 'filament_diameter');
    if (diameter !== null && diameter > 0) filamentDiameterMm = diameter;
    const density = parseConfigNumber(line, 'filament_density');
    if (density !== null && density > 0) filamentDensityGPerCm3 = density;
  }
  const crossSectionMm2 = filamentCrossSectionAreaMm2(filamentDiameterMm);

  const totalTimeAllRoles =
    Array.from(roleTimeSeconds.values()).reduce((a, b) => a + b, 0) + travelTimeSeconds;

  const lineTypeStats: LineTypeStat[] = Array.from(roleFilamentMm.entries())
    .filter(([, mm]) => mm > 0)
    .map(([role, filamentMm]) => {
      const timeSeconds = roleTimeSeconds.get(role) ?? 0;
      const volumeMm3 = filamentMm * crossSectionMm2;
      const filamentGrams = (volumeMm3 / 1000) * filamentDensityGPerCm3;
      return {
        role,
        color: LINE_TYPE_COLORS[role] ?? LINE_TYPE_COLORS.Custom,
        timeSeconds,
        filamentMm,
        filamentGrams,
        usageFraction: totalTimeAllRoles > 0 ? timeSeconds / totalTimeAllRoles : 0,
      };
    })
    // Native lists line types in a fixed role order (see role_to_string's
    // enum declaration order), not by magnitude — approximate that by
    // preserving KNOWN_ROLES iteration order.
    .sort((a, b) => {
      const order = Array.from(KNOWN_ROLES);
      return order.indexOf(a.role) - order.indexOf(b.role);
    });

  const travelStat: TravelStat = {
    timeSeconds: travelTimeSeconds,
    usageFraction: totalTimeAllRoles > 0 ? travelTimeSeconds / totalTimeAllRoles : 0,
    distanceMm: travelDistanceMm,
    moveCount: travelMoveCount,
  };

  const totalEstimation: TotalEstimation = {
    totalFilamentM: totalFilamentMm !== null ? totalFilamentMm / 1000 : null,
    modelFilamentM: totalFilamentMm !== null ? totalFilamentMm / 1000 : null,
    totalFilamentG,
    cost,
    prepareTimeSeconds: firstLayerTimeSeconds,
    modelPrintingTimeSeconds: printTimeSeconds,
    totalTimeSeconds:
      printTimeSeconds !== null
        ? printTimeSeconds
        : null,
    totalLayers: totalLayers ?? (layers.length > 0 ? layers.length : null),
  };

  return { lineTypeStats, travelStat, totalEstimation, segments, layers };
}

/** Format seconds as native's `short_time(get_time_dhms(...))` does for the
 * stats table Time column, e.g. "3m8s", "1h17s", "<1s". */
export function formatShortTime(totalSeconds: number): string {
  if (totalSeconds <= 0) return '';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.round(totalSeconds % 60);

  if (totalSeconds < 1) return '<1s';
  if (hours > 0) return `${hours}h${minutes}m`;
  if (minutes > 0) return `${minutes}m${seconds}s`;
  return `${seconds}s`;
}

/** Format seconds as "15m47s" / "2h3m" style for the Total estimation
 * panel's prepare/print/total time rows (same short format as the table). */
export function formatDuration(totalSeconds: number | null): string {
  if (totalSeconds === null) return '-';
  return formatShortTime(totalSeconds) || '0s';
}

/** Format a filament length in meters to native's "1.37 m" style. */
export function formatFilamentMeters(meters: number | null): string {
  if (meters === null) return '-';
  return `${meters.toFixed(2)} m`;
}

/** Format a filament weight in grams to native's "4.19g" style. */
export function formatWeightGrams(grams: number | null): string {
  if (grams === null) return '-';
  return `${grams.toFixed(2)}g`;
}
