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
  /** Number of moves seen in the source file, before preview sampling. */
  sourceSegmentCount: number;
  /**
   * Every Nth source move retained for the 3D preview. A value of 1 means
   * every move is rendered; larger values mean the preview was simplified
   * to keep a very large print responsive.
   */
  previewSegmentStride: number;
}

/**
 * A browser preview needs considerably more memory per move than the gcode
 * file itself: the parsed object, color/position buffers, and WebGL buffers
 * all coexist briefly. Keep that working set bounded for large plates. The
 * line-type statistics are still accumulated from every source move.
 */
export const MAX_RENDERED_PREVIEW_SEGMENTS = 200_000;

interface StoredToolpathSegment extends ToolpathSegment {
  /** Used internally to adaptively and evenly downsample large previews. */
  sourceSegmentIndex: number;
}

interface SourceLayerInfo {
  startSourceSegmentIndex: number;
  endSourceSegmentIndex: number;
  z: number;
  height: number;
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
class IncrementalGcodeParser {
  // Per-role accumulators for the stats table.
  private readonly roleFilamentMm = new Map<string, number>();
  private readonly roleTimeSeconds = new Map<string, number>();
  private travelTimeSeconds = 0;
  private travelDistanceMm = 0;
  private travelMoveCount = 0;

  // The preview keeps a representative subset of the moves. Statistics are
  // updated before this sampling, so they remain exact for the source file.
  private segments: StoredToolpathSegment[] = [];
  private readonly sourceLayers: SourceLayerInfo[] = [];
  private sourceSegmentCount = 0;
  private previewSegmentStride = 1;

  // Absolute machine state. OrcaSlicer's CLI output uses absolute X/Y/Z
  // positioning (G90, the default) and relative E distances (M83, seen in
  // the sample output's "use relative distances for extrusion" comment) —
  // handle both relative and absolute E defensively since some profiles
  // may emit M82 (absolute E) instead.
  private x = 0;
  private y = 0;
  private z = 0;
  private e = 0;
  private relativeE = true;
  private relativeXYZ = false;
  private feedrateMmPerMin = 0;
  private currentRole = 'Undefined';
  private currentLayerIndex = -1;
  private currentLayerHeight = 0;
  private currentLayerStartSourceSegment = 0;
  private sawAnyLayerChange = false;

  // Native footer values and configuration values, read while the file is
  // streamed instead of making extra full-file passes after parsing.
  private totalFilamentMm: number | null = null;
  private totalFilamentG: number | null = null;
  private cost: number | null = null;
  private totalLayers: number | null = null;
  private printTimeSeconds: number | null = null;
  private firstLayerTimeSeconds: number | null = null;
  private filamentDiameterMm = 1.75;
  private filamentDensityGPerCm3 = 1.24;

  processLine(rawLine: string): void {
    const line = rawLine.trim();
    if (line.length === 0) return;

    if (line.startsWith(';')) {
      this.processComment(line);
      return;
    }

    // Strip trailing inline comments (e.g. "M83 ; use relative ...").
    const codeOnly = line.split(';')[0].trim();
    if (codeOnly.length === 0) return;

    const tokens = codeOnly.split(/\s+/);
    const cmd = tokens[0].toUpperCase();

    if (cmd === 'G90') {
      this.relativeXYZ = false;
      return;
    }
    if (cmd === 'G91') {
      this.relativeXYZ = true;
      return;
    }
    if (cmd === 'M82') {
      this.relativeE = false;
      return;
    }
    if (cmd === 'M83') {
      this.relativeE = true;
      return;
    }
    if (cmd === 'G92') {
      // Reset axis position(s) without moving — most commonly "G92 E0".
      for (const tok of tokens.slice(1)) {
        const axis = tok[0]?.toUpperCase();
        const value = parseAxisToken(tok);
        if (!Number.isFinite(value)) continue;
        if (axis === 'E') this.e = value;
        else if (axis === 'X') this.x = value;
        else if (axis === 'Y') this.y = value;
        else if (axis === 'Z') this.z = value;
      }
      return;
    }

    if (cmd !== 'G0' && cmd !== 'G1') return;

    const x0 = this.x;
    const y0 = this.y;
    const z0 = this.z;
    let hasXY = false;
    let deltaE = 0;
    let hasE = false;

    for (const tok of tokens.slice(1)) {
      const axis = tok[0]?.toUpperCase();
      const value = parseAxisToken(tok);
      if (!Number.isFinite(value)) continue;

      switch (axis) {
        case 'X':
          this.x = this.relativeXYZ ? this.x + value : value;
          hasXY = true;
          break;
        case 'Y':
          this.y = this.relativeXYZ ? this.y + value : value;
          hasXY = true;
          break;
        case 'Z':
          this.z = this.relativeXYZ ? this.z + value : value;
          break;
        case 'E':
          hasE = true;
          if (this.relativeE) {
            deltaE = value;
            this.e += value;
          } else {
            deltaE = value - this.e;
            this.e = value;
          }
          break;
        case 'F':
          this.feedrateMmPerMin = value;
          break;
        default:
          break;
      }
    }

    const dx = this.x - x0;
    const dy = this.y - y0;
    const dz = this.z - z0;
    const distanceMm = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (distanceMm === 0) return;

    const feedrateMmPerSec = this.feedrateMmPerMin > 0 ? this.feedrateMmPerMin / 60 : 0;
    const durationSeconds = feedrateMmPerSec > 0 ? distanceMm / feedrateMmPerSec : 0;

    // Positive E delta with actual XY movement = an extrusion move.
    // (Retract/unretract/wipe E-only moves have hasXY === false and are
    // not counted as line-type extrusion, matching native excluding them
    // from the per-role filament figures.)
    const isExtrusion = hasE && deltaE > 0 && hasXY;

    if (isExtrusion) {
      this.addFilament(this.currentRole, deltaE);
      this.addTime(this.currentRole, durationSeconds);
    } else if (hasXY) {
      this.travelDistanceMm += distanceMm;
      this.travelMoveCount += 1;
      this.travelTimeSeconds += durationSeconds;
    }

    const sourceSegmentIndex = this.sourceSegmentCount;
    this.sourceSegmentCount += 1;
    this.storePreviewSegment({
      x0,
      y0,
      z0,
      x1: this.x,
      y1: this.y,
      z1: this.z,
      role: isExtrusion ? this.currentRole : 'Travel',
      isExtrusion,
      layerIndex: Math.max(this.currentLayerIndex, 0),
      sourceSegmentIndex,
    });
  }

  finish(): ParsedGcode {
    // Close the final layer (no trailing ;LAYER_CHANGE tag after the last one).
    if (this.sawAnyLayerChange) {
      this.closeCurrentLayer(this.sourceSegmentCount);
    } else if (this.sourceSegmentCount > 0) {
      // Degenerate/no layer tags found at all — treat the whole file as one layer.
      this.sourceLayers.push({
        startSourceSegmentIndex: 0,
        endSourceSegmentIndex: this.sourceSegmentCount,
        z: this.z,
        height: this.currentLayerHeight,
      });
    }

    const layers = this.sourceLayers.map((layer) => ({
      startSegmentIndex: this.findPreviewIndex(layer.startSourceSegmentIndex),
      endSegmentIndex: this.findPreviewIndex(layer.endSourceSegmentIndex),
      z: layer.z,
      height: layer.height,
    }));

    // Filament weight per role, derived from length via cross-section area x
    // density — using the same filament_diameter/filament_density values the
    // CLI itself printed into the config-dump footer, so results reconcile
    // with the file's own totals rather than an arbitrary assumed diameter.
    const crossSectionMm2 = filamentCrossSectionAreaMm2(this.filamentDiameterMm);
    const totalTimeAllRoles =
      Array.from(this.roleTimeSeconds.values()).reduce((a, b) => a + b, 0) + this.travelTimeSeconds;
    const roleOrder = Array.from(KNOWN_ROLES);

    const lineTypeStats: LineTypeStat[] = Array.from(this.roleFilamentMm.entries())
      .filter(([, mm]) => mm > 0)
      .map(([role, filamentMm]) => {
        const timeSeconds = this.roleTimeSeconds.get(role) ?? 0;
        const volumeMm3 = filamentMm * crossSectionMm2;
        const filamentGrams = (volumeMm3 / 1000) * this.filamentDensityGPerCm3;
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
      // enum declaration order), not by magnitude.
      .sort((a, b) => roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role));

    const travelStat: TravelStat = {
      timeSeconds: this.travelTimeSeconds,
      usageFraction: totalTimeAllRoles > 0 ? this.travelTimeSeconds / totalTimeAllRoles : 0,
      distanceMm: this.travelDistanceMm,
      moveCount: this.travelMoveCount,
    };

    const totalEstimation: TotalEstimation = {
      totalFilamentM: this.totalFilamentMm !== null ? this.totalFilamentMm / 1000 : null,
      modelFilamentM: this.totalFilamentMm !== null ? this.totalFilamentMm / 1000 : null,
      totalFilamentG: this.totalFilamentG,
      cost: this.cost,
      prepareTimeSeconds: this.firstLayerTimeSeconds,
      modelPrintingTimeSeconds: this.printTimeSeconds,
      totalTimeSeconds: this.printTimeSeconds,
      totalLayers: this.totalLayers ?? (layers.length > 0 ? layers.length : null),
    };

    return {
      lineTypeStats,
      travelStat,
      totalEstimation,
      // StoredToolpathSegment is structurally compatible with ToolpathSegment.
      // Keeping its source index avoids allocating a second 200k-object array.
      segments: this.segments,
      layers,
      sourceSegmentCount: this.sourceSegmentCount,
      previewSegmentStride: this.previewSegmentStride,
    };
  }

  private processComment(line: string): void {
    // Footer/config data can appear anywhere in the file. Capture it as each
    // line arrives, so the streaming path never has to retain the full text.
    let match = line.match(/^;\s*filament used \[mm\]\s*=\s*([\d.eE+-]+)/);
    if (match) {
      this.totalFilamentMm = parseFloat(match[1]);
    } else if ((match = line.match(/^;\s*total filament used \[g\]\s*=\s*([\d.eE+-]+)/))) {
      this.totalFilamentG = parseFloat(match[1]);
    } else if ((match = line.match(/^;\s*total filament cost\s*=\s*([\d.eE+-]+)/))) {
      this.cost = parseFloat(match[1]);
    } else if ((match = line.match(/^;\s*total layers count\s*=\s*([\d.eE+-]+)/))) {
      this.totalLayers = parseInt(match[1], 10);
    } else if ((match = line.match(/^;\s*estimated printing time \([^)]*\)\s*=\s*(.+)$/))) {
      this.printTimeSeconds = parseDurationToSeconds(match[1]);
    } else if ((match = line.match(/^;\s*estimated first layer printing time \([^)]*\)\s*=\s*(.+)$/))) {
      this.firstLayerTimeSeconds = parseDurationToSeconds(match[1]);
    }

    const diameter = parseConfigNumber(line, 'filament_diameter');
    if (diameter !== null && diameter > 0) this.filamentDiameterMm = diameter;
    const density = parseConfigNumber(line, 'filament_density');
    if (density !== null && density > 0) this.filamentDensityGPerCm3 = density;

    // Reserved tag comments (GCodeProcessor::Reserved_Tags_compatible).
    if (line.startsWith(';TYPE:')) {
      const role = line.slice(6).trim();
      this.currentRole = KNOWN_ROLES.has(role) ? role : 'Custom';
    } else if (line.startsWith(';LAYER_CHANGE')) {
      this.closeCurrentLayer(this.sourceSegmentCount);
      this.currentLayerIndex += 1;
      this.currentLayerStartSourceSegment = this.sourceSegmentCount;
      this.sawAnyLayerChange = true;
    } else if (line.startsWith(';HEIGHT:')) {
      const height = parseFloat(line.slice(8).trim());
      if (Number.isFinite(height)) this.currentLayerHeight = height;
    } else if (line.startsWith(';Z:')) {
      const z = parseFloat(line.slice(3).trim());
      if (Number.isFinite(z)) this.z = z;
    }
  }

  private addFilament(role: string, deltaMm: number): void {
    this.roleFilamentMm.set(role, (this.roleFilamentMm.get(role) ?? 0) + deltaMm);
  }

  private addTime(role: string, seconds: number): void {
    this.roleTimeSeconds.set(role, (this.roleTimeSeconds.get(role) ?? 0) + seconds);
  }

  private closeCurrentLayer(endSourceSegmentIndex: number): void {
    if (this.currentLayerIndex < 0) return;
    this.sourceLayers.push({
      startSourceSegmentIndex: this.currentLayerStartSourceSegment,
      endSourceSegmentIndex,
      z: this.z,
      height: this.currentLayerHeight,
    });
  }

  private storePreviewSegment(segment: StoredToolpathSegment): void {
    // When the cap is reached, double the stride and retain the matching
    // subset of already-seen moves. This keeps samples evenly distributed
    // over the whole plate rather than showing only its earliest moves.
    while (this.segments.length >= MAX_RENDERED_PREVIEW_SEGMENTS) {
      this.previewSegmentStride *= 2;
      this.segments = this.segments.filter(
        (stored) => stored.sourceSegmentIndex % this.previewSegmentStride === 0
      );
    }

    if (segment.sourceSegmentIndex % this.previewSegmentStride === 0) {
      this.segments.push(segment);
    }
  }

  /** Lower bound by source move index; retained preview segments stay ordered. */
  private findPreviewIndex(sourceSegmentIndex: number): number {
    let low = 0;
    let high = this.segments.length;
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2);
      if (this.segments[middle].sourceSegmentIndex < sourceSegmentIndex) low = middle + 1;
      else high = middle;
    }
    return low;
  }
}

/**
 * Parse a complete gcode string. Kept for tests and callers with an
 * in-memory string; the browser preview uses parseGcodeStream below so a
 * large response is never duplicated into a full string and line array.
 */
export function parseGcode(text: string): ParsedGcode {
  const parser = new IncrementalGcodeParser();
  for (const line of text.split('\n')) parser.processLine(line);
  return parser.finish();
}

/**
 * Parse a gcode HTTP response body incrementally. This avoids the previous
 * response.text() -> split('\n') peak-memory spike that caused large plates
 * to fail in the browser even though slicing had completed successfully.
 */
export async function parseGcodeStream(stream: ReadableStream<Uint8Array>): Promise<ParsedGcode> {
  const parser = new IncrementalGcodeParser();
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = '';

  const processDecodedChunk = (chunk: string) => {
    pending += chunk;
    let start = 0;
    let newlineIndex = pending.indexOf('\n', start);
    while (newlineIndex !== -1) {
      parser.processLine(pending.slice(start, newlineIndex));
      start = newlineIndex + 1;
      newlineIndex = pending.indexOf('\n', start);
    }
    pending = pending.slice(start);
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) processDecodedChunk(decoder.decode(value, { stream: true }));
    }
    processDecodedChunk(decoder.decode());
    if (pending.length > 0) parser.processLine(pending);
    return parser.finish();
  } finally {
    reader.releaseLock();
  }
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
