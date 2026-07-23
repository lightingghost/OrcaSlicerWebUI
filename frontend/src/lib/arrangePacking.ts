import * as THREE from 'three';

/**
 * arrangePacking
 *
 * "Arrange" logic ported from OrcaSlicer native's libslic3r/Arrange.cpp
 * (AutoArranger::objfunc + fill_config), wired up via
 * slic3r/GUI/Jobs/ArrangeJob.cpp and the settings popup rendered in
 * GLCanvas3D::_render_arrange_menu.
 *
 * Native's real placement engine is libnest2d: a no-fit-polygon (NFP)
 * nester (nlopt/subplex optimizer searching the true polygon contact
 * positions) driving a custom multi-term cost function
 * (`AutoArranger::objfunc`). A byte-exact port of the NFP contact-point
 * search itself is out of scope here (it depends on Clipper's exact
 * polygon boolean ops and a general nonlinear optimizer) — instead this
 * module ports `objfunc`'s scoring logic verbatim (the BIG_ITEM /
 * LAST_BIG_ITEM / SMALL_ITEM cases, the 5-anchor-point distance term, the
 * density term, the same-area-neighbor alignment term, the
 * similar-height-neighbor term, and the bin overfit penalty) and
 * evaluates it over a candidate set of touching positions (the corners of
 * already-placed item boxes — the standard bottom-left-fill candidate
 * set) instead of true NFP contact points. Each item is placed at
 * whichever (rotation, position) candidate minimizes the ported score,
 * exactly mirroring what the real optimizer is trying to minimize, just
 * over a coarser candidate set.
 *
 * Ported 1:1 from native:
 *  - `fill_config`: `starting_point = TOP_RIGHT` (this app never models
 *    sequential/by-object printing, so the `is_seq_print` branch —
 *    `BOTTOM_LEFT` — is not implemented), `alignment = CENTER` (since
 *    `do_final_align` defaults true), rotation candidates
 *    `{0, 45, 90, 135} deg` when "Auto rotate for arrangement" is on.
 *  - `AutoArranger::objfunc`: BIG_ITEM / LAST_BIG_ITEM / SMALL_ITEM cases,
 *    `BIG_ITEM_TRESHOLD = 0.02`, the five-anchor-point distance-to-pile-
 *    center term, `dist_to_bin` (TOP_RIGHT variant), the same-area-
 *    neighbor alignment score, the density term, and the "objects with
 *    similar height are placed together" term (native's non-seq-print
 *    branch, which uses each item's real height and `printable_height`).
 *  - `AutoArranger<Box>::get_objfn`'s wrapper: the bin overfit penalty
 *    (`Placer::overfit(Box, Box)`) and the `LARGE_COST_TO_REJECT` (1e7)
 *    cap.
 *  - `update_selected_items_inflation`: spacing/2 inflates each item's
 *    footprint before packing. "0 means auto spacing" — native falls back
 *    to each object's brim width (or tree-support branch radius); since
 *    this app doesn't model per-object brim, it falls back to a small
 *    fixed default (see `AUTO_SPACING_MM`).
 *  - `update_selected_items_axis_align`: 2D image-moment principal-axis
 *    angle for "Align to Y axis" (mutually exclusive with rotation,
 *    matching native's UI).
 *  - `do_final_align`: the arranged pile is centered on the bed after
 *    packing.
 *
 * Not modeled (this app has no per-object data for these, so the
 * corresponding `objfunc` terms are simply omitted rather than
 * approximated — matching the terms' actual effect of "no-op when there's
 * only one material/extruder/temperature"):
 *  - extruder/filament-temperature grouping penalties
 *    (`allow_multi_materials_on_same_plate`, `LARGE_COST_TO_REJECT` for
 *    incompatible filament temps) — the "Allow multiple materials on same
 *    plate" checkbox is preserved in the UI (default true, matching
 *    native) but has no placement effect since there's nothing to group.
 *  - sequential/by-object printing (`is_seq_print`, clearance-radius/rod/
 *    lid conflicts) — this app only supports normal (simultaneous) print.
 */

/** Fallback gap (mm) used when spacing is 0 ("auto spacing"), since this
 * app has no per-object brim-width model to fall back to like native does. */
export const AUTO_SPACING_MM = 2;

/** Candidate rotation angles (radians) tried for "Auto rotate for
 * arrangement", matching native's fill_config: {0, 45, 90, 135} degrees. */
const ROTATION_CANDIDATES_RAD = [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4];

/** Native's `BIG_ITEM_TRESHOLD`: area/bin_area ratio above which an item is
 * treated as "big" in `AutoArranger::objfunc`. */
const BIG_ITEM_TRESHOLD = 0.02;

/** Native's `LARGE_COST_TO_REJECT` (libnest2d/nester.hpp). */
const LARGE_COST_TO_REJECT = 1e7;

/** Native's `ArrangeParams::printable_height` default, used by the
 * "similar height objects placed together" objfunc term when the app has
 * no per-plate printable-height value available. */
const DEFAULT_PRINTABLE_HEIGHT_MM = 256.0;

export interface Point2D {
  x: number;
  y: number;
}

/** Andrew's monotone chain convex hull, O(n log n). Returns points in CCW order. */
export function convexHull2D(points: Point2D[]): Point2D[] {
  const pts = Array.from(new Set(points.map((p) => `${p.x},${p.y}`))).map((s) => {
    const [x, y] = s.split(',').map(Number);
    return { x, y };
  });
  if (pts.length <= 2) return pts;

  pts.sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));

  const cross = (o: Point2D, a: Point2D, b: Point2D) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower: Point2D[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: Point2D[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

export interface AABB2D {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function computeAABB2D(points: Point2D[]): AABB2D {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export function rotatePoints2D(points: Point2D[], angleRad: number, pivot: Point2D): Point2D[] {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  return points.map((p) => {
    const dx = p.x - pivot.x;
    const dy = p.y - pivot.y;
    return {
      x: pivot.x + dx * cos - dy * sin,
      y: pivot.y + dx * sin + dy * cos,
    };
  });
}

/**
 * Find whichever of the 4 candidate angles {0, 45, 90, 135deg} gives the
 * smallest-area axis-aligned bounding box for the given hull. Kept as a
 * standalone geometry helper (used by tests and previously by the packer);
 * `computeArrangePlan`'s own search now evaluates all 4 candidates jointly
 * with position via the ported objfunc score rather than picking a
 * rotation by bounding-box area alone, since native's rotation candidates
 * are searched jointly with placement too (`fill_config`'s
 * `pcfg.rotations`, searched by the NFP placer alongside position).
 */
export function findBestRotationAngle(hullPoints: Point2D[]): number {
  const pivot = aabbCenter(computeAABB2D(hullPoints));
  let bestAngle = 0;
  let bestArea = Infinity;
  for (const angle of ROTATION_CANDIDATES_RAD) {
    const rotated = rotatePoints2D(hullPoints, angle, pivot);
    const box = computeAABB2D(rotated);
    const area = (box.maxX - box.minX) * (box.maxY - box.minY);
    if (area < bestArea - 1e-9) {
      bestArea = area;
      bestAngle = angle;
    }
  }
  return bestAngle;
}

/**
 * Direct port of native's `update_selected_items_axis_align` (Arrange.cpp):
 * computes the polygon's principal-axis angle from its 2D image moments,
 * then returns the additional rotation needed to align that axis with Y.
 * Returns 0 if the shape has no dominant axis (a≈c, i.e. roughly
 * square/round — matching native's `ratio > 0.66` bail-out).
 */
export function computeAlignToYAxisAngle(hullPoints: Point2D[]): number {
  const pts = hullPoints;
  const n = pts.length;
  if (n < 3) return 0;

  let a00 = 0, a10 = 0, a01 = 0, a20 = 0, a11 = 0, a02 = 0, a30 = 0, a21 = 0, a12 = 0, a03 = 0;
  let xi_1 = pts[n - 1].x;
  let yi_1 = pts[n - 1].y;
  let xi_12 = xi_1 * xi_1;
  let yi_12 = yi_1 * yi_1;

  for (let i = 0; i < n; i++) {
    const xi = pts[i].x;
    const yi = pts[i].y;
    const xi2 = xi * xi;
    const yi2 = yi * yi;
    const dxy = xi_1 * yi - xi * yi_1;
    const xii_1 = xi_1 + xi;
    const yii_1 = yi_1 + yi;

    a00 += dxy;
    a10 += dxy * xii_1;
    a01 += dxy * yii_1;
    a20 += dxy * (xi_1 * xii_1 + xi2);
    a11 += dxy * (xi_1 * (yii_1 + yi_1) + xi * (yii_1 + yi));
    a02 += dxy * (yi_1 * yii_1 + yi2);
    a30 += dxy * xii_1 * (xi_12 + xi2);
    a03 += dxy * yii_1 * (yi_12 + yi2);
    a21 += dxy * (xi_12 * (3 * yi_1 + yi) + 2 * xi * xi_1 * yii_1 + xi2 * (yi_1 + 3 * yi));
    a12 += dxy * (yi_12 * (3 * xi_1 + xi) + 2 * yi * yi_1 * xii_1 + yi2 * (xi_1 + 3 * xi));

    xi_1 = xi;
    yi_1 = yi;
    xi_12 = xi2;
    yi_12 = yi2;
  }

  void a30;
  void a21;
  void a12;
  void a03;

  const EPSILON = 1e-9;
  if (Math.abs(a00) <= EPSILON) return 0;

  const sign = a00 > 0 ? 1 : -1;
  const db1_2 = 0.5 * sign;
  const db1_6 = (1 / 6) * sign;
  const db1_12 = (1 / 12) * sign;
  const db1_24 = (1 / 24) * sign;

  const m00 = a00 * db1_2;
  const m10 = a10 * db1_6;
  const m01 = a01 * db1_6;
  const m20 = a20 * db1_12;
  const m11 = a11 * db1_24;
  const m02 = a02 * db1_12;

  const cx = m10 / m00;
  const cy = m01 / m00;

  const a = m20 / m00 - cx * cx;
  const b = m11 / m00 - cx * cy;
  const c = m02 / m00 - cy * cy;

  const ratio = Math.abs(a) > Math.abs(c) ? Math.abs(c / a) : Math.abs(c) > 0 ? Math.abs(a / c) : 0;
  if (ratio > 0.66) return 0;

  let angle = Math.atan2(2 * b, a - c) / 2;
  angle = Math.PI / 2 - angle;
  if (Math.abs(Math.abs(angle) - Math.PI) < 0.01) angle = 0;
  return angle;
}

function aabbCenter(box: AABB2D): Point2D {
  return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
}

function boxWidth(b: AABB2D): number {
  return b.maxX - b.minX;
}

function boxHeight(b: AABB2D): number {
  return b.maxY - b.minY;
}

function boxArea(b: AABB2D): number {
  return Math.max(0, boxWidth(b)) * Math.max(0, boxHeight(b));
}

function unionBox(a: AABB2D, b: AABB2D): AABB2D {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

/** Strict overlap test for placement collision rejection: boxes that only
 * touch along an edge (share a boundary) do NOT count as colliding, so
 * bottom-left-fill anchors flush against an already-placed item's edge
 * remain valid candidates. */
function boxesOverlapStrict(a: AABB2D, b: AABB2D): boolean {
  return a.minX < b.maxX - 1e-6 && a.maxX > b.minX + 1e-6 && a.minY < b.maxY - 1e-6 && a.maxY > b.minY + 1e-6;
}

/** Touching-inclusive intersection test, matching native's
 * `bgi::intersects` query used by objfunc's neighbor-alignment lookup
 * (boxes that merely touch DO count as neighbors there). */
function boxesIntersect(a: AABB2D, b: AABB2D): boolean {
  return a.minX <= b.maxX + 1e-9 && a.maxX >= b.minX - 1e-9 && a.minY <= b.maxY + 1e-9 && a.maxY >= b.minY - 1e-9;
}

function dist2D(a: Point2D, b: Point2D): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Shoelace formula on a simple (convex hull) polygon — the item's true
 * footprint area, as opposed to its (larger) bounding-box area. Native's
 * `item.area()` is the real (Clipper) polygon area; this is the same
 * concept applied to our convex-hull footprint approximation. */
function polygonArea2D(hull: Point2D[]): number {
  if (hull.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < hull.length; i++) {
    const p1 = hull[i];
    const p2 = hull[(i + 1) % hull.length];
    sum += p1.x * p2.y - p2.x * p1.y;
  }
  return Math.abs(sum) / 2;
}

export interface BinBox2D {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface PlacedItem {
  id: string;
  bb: AABB2D;
  area: number;
  isBig: boolean;
  heightMm: number;
}

/**
 * Ported from `AutoArranger::objfunc` (Arrange.cpp), restricted to the
 * `starting_point == TOP_RIGHT` branch (this app never sets
 * `is_seq_print`, so the `BOTTOM_LEFT` branch native uses for by-object/
 * sequential printing is not implemented) and to the terms this app has
 * real data for (see the module doc comment for what's omitted and why).
 * `origin` is the bin's top-right corner ( == `m_bin.maxCorner()`, the
 * `origin_pack` used by `AutoArranger<Box>::get_objfn`).
 */
function objfuncScore(
  itemBB: AABB2D,
  itemArea: number,
  itemHeightMm: number,
  placed: PlacedItem[],
  pileBB: AABB2D | null,
  remaining: number,
  itemCount: number,
  origin: Point2D,
  normFactor: number,
  binArea: number,
  printableHeightMm: number,
  bin: BinBox2D | undefined
): number {
  const norm = (v: number) => v / normFactor;
  const fullBB = pileBB ? unionBox(pileBB, itemBB) : itemBB;

  const bigPlaced = placed.filter((p) => p.isBig);
  const bigBB = bigPlaced.length > 0 ? bigPlaced.reduce((acc, p) => unionBox(acc, p.bb), bigPlaced[0].bb) : fullBB;

  const isBigItem = itemArea / binArea > BIG_ITEM_TRESHOLD;
  // `bigitems = isBig(item.area()) || spatindex.empty()`
  const bigItemsCase = isBigItem || bigPlaced.length === 0;

  let score = 0;

  if (bigItemsCase && remaining > 0) {
    // --- BIG_ITEM ---
    const minc = { x: itemBB.minX, y: itemBB.minY };
    const maxc = { x: itemBB.maxX, y: itemBB.maxY };
    const center = aabbCenter(itemBB);
    const topLeft = { x: itemBB.minX, y: itemBB.maxY };
    const bottomRight = { x: itemBB.maxX, y: itemBB.minY };
    const cc = aabbCenter(fullBB);
    const dists = [minc, maxc, center, topLeft, bottomRight].map((p) => dist2D(p, cc));
    let dist = norm(Math.min(...dists));

    const bindist = norm(dist2D(maxc, origin)); // dist_to_bin, TOP_RIGHT variant
    dist = 0.8 * dist + 0.2 * bindist;

    // Alignment-with-neighbors score: query the same spatial index native
    // would (big-items rtree if this item is big, else the "all items"
    // smalls rtree), and look for same-area neighbors.
    const index = isBigItem ? bigPlaced : placed;
    let alignmentScore = 1.0;
    let hasNeighbor = false;
    for (const p of index) {
      if (!boxesIntersect(itemBB, p.bb)) continue;
      hasNeighbor = true;
      if (Math.abs(1 - p.area / itemArea) < 1e-6) {
        const bb = unionBox(p.bb, itemBB);
        const bbArea = boxArea(bb);
        const ascore = bbArea > 0 ? 1 - (itemArea + p.area) / bbArea : 1;
        if (ascore < alignmentScore) alignmentScore = ascore;
      }
    }

    const density = Math.sqrt(norm(boxWidth(fullBB)) * norm(boxHeight(fullBB)));
    const R = remaining / itemCount;
    const itemBBoxArea = boxArea(itemBB);
    const alignmentWeight = Math.max(0.3, 0.6 * (itemBBoxArea > 0 ? itemArea / itemBBoxArea : 1));

    if (!hasNeighbor) {
      score = 0.5 * dist + 0.5 * density;
    } else {
      score = (1 - 0.2 - alignmentWeight) * dist + (1 - R) * 0.2 * density + alignmentWeight * alignmentScore;
    }
  } else if (bigItemsCase && remaining === 0) {
    // --- LAST_BIG_ITEM ---
    if (pileBB) {
      score = 0.5 * norm(dist2D(aabbCenter(itemBB), aabbCenter(pileBB)));
    } else {
      score = 0.5 * norm(dist2D(aabbCenter(itemBB), origin));
    }
  } else {
    // --- SMALL_ITEM ---
    score = 0.8 * norm(dist2D(aabbCenter(itemBB), aabbCenter(bigBB))) + 0.2 * norm(dist2D(aabbCenter(itemBB), origin));
  }

  // "Objects with similar height get placed together" term (native's
  // non-seq-print branch of objfunc).
  if (placed.length > 0) {
    let heightScore = 0;
    for (const p of placed) {
      heightScore +=
        (1 - Math.abs(itemHeightMm - p.heightMm) / printableHeightMm) * norm(dist2D(aabbCenter(itemBB), aabbCenter(p.bb)));
    }
    score += heightScore / placed.length;
  }

  // AutoArranger<Box>::get_objfn's overfit-against-bin wrapper.
  if (bin) {
    const wdiff = boxWidth(fullBB) - (bin.maxX - bin.minX);
    const hdiff = boxHeight(fullBB) - (bin.maxY - bin.minY);
    let diff = 0;
    if (wdiff > 0) diff += wdiff;
    if (hdiff > 0) diff += hdiff;
    const miss = diff > 0 ? diff : 0;
    score += miss * miss;
    if (score > LARGE_COST_TO_REJECT) score = 1.5 * LARGE_COST_TO_REJECT;
  }

  return score;
}

export interface ArrangeCandidateItem {
  id: string;
  /** World-space XY footprint convex hull, in the item's current (input)
   * orientation. */
  hull: Point2D[];
  /** World-space Z extent (mm), used by the "similar height" objfunc term. */
  heightMm: number;
}

export interface ArrangePackOptions {
  /** mm. 0 means "auto spacing" (falls back to AUTO_SPACING_MM). */
  spacingMm: number;
  enableRotation: boolean;
  alignToYAxis: boolean;
  /** Bed bounding box in the same world XY coordinates as the item hulls
   * (bed center assumed at world origin, per this app's convention).
   * When omitted, the bin-relative terms (`dist_to_bin`, the overfit
   * penalty) are skipped and `BIG_ITEM_TRESHOLD`/normalization fall back
   * to the arranged items' own total footprint area, matching the
   * `InfiniteBed` case native supports when no real bed is known. */
  bin?: BinBox2D;
  /** mm. Native's `ArrangeParams::printable_height` (default 256). */
  printableHeightMm?: number;
}

export interface ArrangePackResult {
  targetCenters: Map<string, Point2D>;
  /** Rotation (radians) chosen for each item — 0 unless rotation or
   * align-to-Y-axis is enabled. */
  rotations: Map<string, number>;
}

/**
 * Faithful port of `AutoArranger::objfunc`-driven placement (see module
 * doc comment for exactly what is and isn't ported). Items are placed one
 * at a time, largest-footprint-first — matching native's `sortfunc` tie-
 * break of `area() desc` once priority/bed_temp/extruder terms are
 * excluded (this app has no per-object priority, bed-temp, or extruder
 * data) — and for each item, every (rotation candidate x position
 * candidate) combination is scored with the ported objfunc; the minimum-
 * score combination is chosen, exactly mirroring what native's NFP
 * optimizer searches for, just over a coarser (corner-touching) position
 * candidate set instead of true no-fit-polygon contact points.
 */
export function objfuncArrangePack(items: ArrangeCandidateItem[], opts: ArrangePackOptions): ArrangePackResult {
  const spacing = opts.spacingMm > 0 ? opts.spacingMm : AUTO_SPACING_MM;
  const printableHeightMm = opts.printableHeightMm ?? DEFAULT_PRINTABLE_HEIGHT_MM;
  const bin = opts.bin;

  const totalFootprintArea = items.reduce((s, it) => s + polygonArea2D(it.hull), 0);
  const binArea = bin ? (bin.maxX - bin.minX) * (bin.maxY - bin.minY) : totalFootprintArea || 1;
  const normFactor = Math.sqrt(binArea) || 1;
  const origin: Point2D = bin ? { x: bin.maxX, y: bin.maxY } : { x: 0, y: 0 };

  const order = [...items].sort((a, b) => polygonArea2D(b.hull) - polygonArea2D(a.hull));
  const itemCount = order.length;

  const placed: PlacedItem[] = [];
  let pileBB: AABB2D | null = null;

  const targetCenters = new Map<string, Point2D>();
  const rotations = new Map<string, number>();

  order.forEach((it, idx) => {
    const remaining = itemCount - idx - 1;
    const originalBox = computeAABB2D(it.hull);
    const pivot = aabbCenter(originalBox);
    const itemPolyArea = polygonArea2D(it.hull);

    let candidateAngles: number[];
    if (opts.enableRotation) {
      candidateAngles = ROTATION_CANDIDATES_RAD;
    } else if (opts.alignToYAxis) {
      candidateAngles = [computeAlignToYAxisAngle(it.hull)];
    } else {
      candidateAngles = [0];
    }

    // Bottom-left-fill-style touching-point candidates: every already
    // placed item's top-left and bottom-right corners (plus the origin),
    // used as candidates for the new item's bottom-left corner. This
    // stands in for native's true NFP contact points (see doc comment).
    const anchors: Point2D[] = [{ x: 0, y: 0 }];
    for (const p of placed) {
      anchors.push({ x: p.bb.maxX, y: p.bb.minY });
      anchors.push({ x: p.bb.minX, y: p.bb.maxY });
    }

    let best: { score: number; angle: number; bb: AABB2D } | null = null;

    for (const angle of candidateAngles) {
      const rotatedHull = angle !== 0 ? rotatePoints2D(it.hull, angle, pivot) : it.hull;
      const localBox = computeAABB2D(rotatedHull);
      const w = localBox.maxX - localBox.minX + spacing;
      const h = localBox.maxY - localBox.minY + spacing;

      for (const anchor of anchors) {
        const bb: AABB2D = { minX: anchor.x, minY: anchor.y, maxX: anchor.x + w, maxY: anchor.y + h };
        const collides = placed.some((p) => boxesOverlapStrict(bb, p.bb));
        if (collides) continue;

        const score = objfuncScore(
          bb,
          itemPolyArea,
          it.heightMm,
          placed,
          pileBB,
          remaining,
          itemCount,
          origin,
          normFactor,
          binArea,
          printableHeightMm,
          bin
        );

        if (!best || score < best.score - 1e-9) {
          best = { score, angle, bb };
        }
      }
    }

    if (!best) {
      // Guard against degenerate input (e.g. a single zero-size item) —
      // should not normally happen since anchors always include the
      // ever-growing pile corners.
      const w = boxWidth(originalBox) + spacing;
      const h = boxHeight(originalBox) + spacing;
      best = { score: 0, angle: 0, bb: { minX: 0, minY: 0, maxX: w, maxY: h } };
    }

    const isBig = itemPolyArea / binArea > BIG_ITEM_TRESHOLD;
    placed.push({ id: it.id, bb: best.bb, area: itemPolyArea, isBig, heightMm: it.heightMm });
    pileBB = pileBB ? unionBox(pileBB, best.bb) : best.bb;

    targetCenters.set(it.id, aabbCenter(best.bb));
    rotations.set(it.id, best.angle);
  });

  // do_final_align: center the arranged pile on the bed (world origin, by
  // this app's bed-center-at-origin convention).
  if (pileBB) {
    const c = aabbCenter(pileBB);
    for (const [id, center] of targetCenters) {
      targetCenters.set(id, { x: center.x - c.x, y: center.y - c.y });
    }
  }

  return { targetCenters, rotations };
}

// ---------------------------------------------------------------------------
// Three.js mesh helpers
// ---------------------------------------------------------------------------

/** World-space XY footprint points for a mesh (its own vertices, no hull reduction needed for AABB use, but hull keeps point counts low for the moment/rotation math). */
export function getWorldFootprintHull(object: THREE.Object3D): Point2D[] {
  object.updateMatrixWorld(true);
  const rawPoints: Point2D[] = [];
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const positionAttr = child.geometry.getAttribute('position');
    if (!positionAttr) return;
    const worldMatrix = child.matrixWorld;
    const v = new THREE.Vector3();
    for (let i = 0; i < positionAttr.count; i++) {
      v.fromBufferAttribute(positionAttr, i).applyMatrix4(worldMatrix);
      rawPoints.push({ x: v.x, y: v.y });
    }
  });
  return convexHull2D(rawPoints);
}

/** World-space Z extent (mm) of a mesh, used for the "similar height
 * objects placed together" objfunc term. */
export function getWorldHeight(object: THREE.Object3D): number {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  if (!isFinite(box.min.z) || !isFinite(box.max.z)) return 0;
  return Math.max(0, box.max.z - box.min.z);
}

export interface ArrangeSettingsInput {
  /** mm. 0 means "auto spacing" (falls back to AUTO_SPACING_MM). */
  spacingMm: number;
  enableRotation: boolean;
  alignToYAxis: boolean;
  /** Bed size (mm), if known — bed is assumed centered at the world
   * origin. Enables the bin-relative objfunc terms (`dist_to_bin`, the
   * overfit penalty) and an accurate `BIG_ITEM_TRESHOLD` reference area,
   * matching native's real (non-infinite) bed. */
  bedSize?: { width: number; depth: number };
  /** mm. Native's `ArrangeParams::printable_height` (default 256). */
  printableHeightMm?: number;
}

export interface ArrangePlan {
  /** Target world XY center for the object's footprint AABB, per mesh id. */
  targetCenters: Map<string, Point2D>;
  /** Additional Z-axis rotation (radians) to apply to each mesh, per id. */
  extraRotations: Map<string, number>;
}

/**
 * Compute a full arrange plan for a set of meshes: gathers each mesh's
 * world footprint hull and height, then delegates to `objfuncArrangePack`
 * (the ported native placement/scoring logic). Does not mutate any mesh;
 * callers apply the plan themselves (see ThreeViewport, which needs to
 * account for each mesh's current position/rotation pivot when applying
 * the result).
 */
export function computeArrangePlan(
  meshes: Array<{ id: string; object: THREE.Object3D }>,
  settings: ArrangeSettingsInput
): ArrangePlan {
  const items: ArrangeCandidateItem[] = meshes.map(({ id, object }) => ({
    id,
    hull: getWorldFootprintHull(object),
    heightMm: getWorldHeight(object),
  }));

  const bin: BinBox2D | undefined = settings.bedSize
    ? {
        minX: -settings.bedSize.width / 2,
        minY: -settings.bedSize.depth / 2,
        maxX: settings.bedSize.width / 2,
        maxY: settings.bedSize.depth / 2,
      }
    : undefined;

  const result = objfuncArrangePack(items, {
    spacingMm: settings.spacingMm,
    enableRotation: settings.enableRotation,
    alignToYAxis: settings.alignToYAxis,
    bin,
    printableHeightMm: settings.printableHeightMm,
  });

  return { targetCenters: result.targetCenters, extraRotations: result.rotations };
}
