import { describe, it, expect } from 'vitest';
import sampleGcode from './__fixtures__/sample.gcode?raw';
import {
  MAX_RENDERED_PREVIEW_SEGMENTS,
  parseGcode,
  parseGcodeStream,
  formatShortTime,
  formatDuration,
  formatFilamentMeters,
  formatWeightGrams,
  LINE_TYPE_COLORS,
} from './gcodeParser';

describe('parseGcode', () => {
  it('extracts line type stats for all roles present in the sample gcode', () => {
    const result = parseGcode(sampleGcode);

    // From the real CLI-generated sample: ;TYPE: tags seen were Custom,
    // Inner wall, Outer wall, Bottom surface, Internal solid infill,
    // Gap infill, Sparse infill, Internal Bridge, Top surface.
    const roles = result.lineTypeStats.map((s) => s.role);
    expect(roles).toContain('Inner wall');
    expect(roles).toContain('Outer wall');
    expect(roles).toContain('Sparse infill');
    expect(roles).toContain('Internal solid infill');
    expect(roles).toContain('Top surface');
    expect(roles).toContain('Gap infill');
  });

  it('assigns the correct native color to each line type', () => {
    const result = parseGcode(sampleGcode);
    const innerWall = result.lineTypeStats.find((s) => s.role === 'Inner wall');
    expect(innerWall?.color).toEqual([255, 230, 77]);

    const outerWall = result.lineTypeStats.find((s) => s.role === 'Outer wall');
    expect(outerWall?.color).toEqual([255, 125, 56]);
  });

  it('computes positive filament length and time for extruding roles', () => {
    const result = parseGcode(sampleGcode);
    for (const stat of result.lineTypeStats) {
      expect(stat.filamentMm).toBeGreaterThan(0);
      expect(stat.filamentGrams).toBeGreaterThanOrEqual(0);
      expect(stat.timeSeconds).toBeGreaterThanOrEqual(0);
    }
  });

  it('usage fractions across all roles plus travel sum to ~1', () => {
    const result = parseGcode(sampleGcode);
    const sum =
      result.lineTypeStats.reduce((acc, s) => acc + s.usageFraction, 0) +
      result.travelStat.usageFraction;
    expect(sum).toBeGreaterThan(0.9);
    expect(sum).toBeLessThanOrEqual(1.0001);
  });

  it('parses total estimation figures from the footer comment block', () => {
    const result = parseGcode(sampleGcode);
    // From the real sample's footer:
    // ; filament used [mm] = 1182.24
    // ; total filament used [g] = 0.00
    // ; total layers count = 100
    // ; estimated printing time (normal mode) = 27m 7s
    // ; estimated first layer printing time (normal mode) = 2m 25s
    expect(result.totalEstimation.totalFilamentM).toBeCloseTo(1.18224, 3);
    expect(result.totalEstimation.totalLayers).toBe(100);
    expect(result.totalEstimation.modelPrintingTimeSeconds).toBe(27 * 60 + 7);
    expect(result.totalEstimation.prepareTimeSeconds).toBe(2 * 60 + 25);
  });

  it('groups toolpath segments into layers matching the LAYER_CHANGE tag count', () => {
    const result = parseGcode(sampleGcode);
    expect(result.layers.length).toBeGreaterThan(0);
    // Layers should be contiguous and non-overlapping.
    for (let i = 1; i < result.layers.length; i++) {
      expect(result.layers[i].startSegmentIndex).toBe(result.layers[i - 1].endSegmentIndex);
    }
    // Last layer should end exactly at the last segment.
    expect(result.layers[result.layers.length - 1].endSegmentIndex).toBe(result.segments.length);
  });

  it('marks non-extruding moves as Travel segments', () => {
    const result = parseGcode(sampleGcode);
    const travelSegments = result.segments.filter((s) => !s.isExtrusion);
    expect(travelSegments.length).toBeGreaterThan(0);
    for (const seg of travelSegments) {
      expect(seg.role).toBe('Travel');
    }
  });

  it('handles empty input without throwing', () => {
    const result = parseGcode('');
    expect(result.lineTypeStats).toEqual([]);
    expect(result.segments).toEqual([]);
    expect(result.layers).toEqual([]);
  });

  it('handles gcode with no reserved tags (plain moves only)', () => {
    const plain = 'G90\nG1 X10 Y10 F3000\nG1 X20 Y20 E1 F1200\n';
    const result = parseGcode(plain);
    expect(result.segments.length).toBe(2);
    expect(result.segments[0].isExtrusion).toBe(false);
    expect(result.segments[1].isExtrusion).toBe(true);
  });

  it('supports relative E (M83) and absolute E (M82) correctly', () => {
    const relative = 'M83\nG1 X10 Y10 E1 F1200\nG1 X20 Y20 E1 F1200\n';
    const resultRelative = parseGcode(relative);
    const totalRelative = resultRelative.lineTypeStats.reduce((a, s) => a + s.filamentMm, 0);
    expect(totalRelative).toBeCloseTo(2, 5);

    const absolute = 'M82\nG1 X10 Y10 E1 F1200\nG1 X20 Y20 E2 F1200\n';
    const resultAbsolute = parseGcode(absolute);
    const totalAbsolute = resultAbsolute.lineTypeStats.reduce((a, s) => a + s.filamentMm, 0);
    expect(totalAbsolute).toBeCloseTo(2, 5);
  });

  it('streams chunked gcode without changing the parsed result', async () => {
    const bytes = new TextEncoder().encode(sampleGcode);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // Deliberately split inside lines and UTF-8 chunks, as a real HTTP
        // response can do. The parser must carry an incomplete line forward.
        for (let offset = 0; offset < bytes.length; offset += 137) {
          controller.enqueue(bytes.slice(offset, offset + 137));
        }
        controller.close();
      },
    });

    const streamed = await parseGcodeStream(stream);
    const inMemory = parseGcode(sampleGcode);

    expect(streamed.segments).toHaveLength(inMemory.segments.length);
    expect(streamed.layers).toEqual(inMemory.layers);
    expect(streamed.lineTypeStats).toEqual(inMemory.lineTypeStats);
    expect(streamed.totalEstimation).toEqual(inMemory.totalEstimation);
  });

  it('bounds rendered toolpath storage while keeping full-file statistics', () => {
    const sourceMoveCount = MAX_RENDERED_PREVIEW_SEGMENTS + 1;
    const moves = Array.from(
      { length: sourceMoveCount },
      (_, index) => `G1 X${(index + 1) % 2} Y${(index + 1) % 2} E0.1 F1200`
    );
    const result = parseGcode(`M83\n;LAYER_CHANGE\n;TYPE:Inner wall\n${moves.join('\n')}\n`);

    expect(result.sourceSegmentCount).toBe(sourceMoveCount);
    expect(result.segments.length).toBeLessThanOrEqual(MAX_RENDERED_PREVIEW_SEGMENTS);
    expect(result.previewSegmentStride).toBeGreaterThan(1);
    expect(result.lineTypeStats.find((stat) => stat.role === 'Inner wall')?.filamentMm)
      .toBeCloseTo(sourceMoveCount * 0.1, 5);
  });
});

describe('LINE_TYPE_COLORS', () => {
  it('contains every native role referenced by role_to_string', () => {
    expect(LINE_TYPE_COLORS['Inner wall']).toBeDefined();
    expect(LINE_TYPE_COLORS['Outer wall']).toBeDefined();
    expect(LINE_TYPE_COLORS['Sparse infill']).toBeDefined();
    expect(LINE_TYPE_COLORS['Bridge']).toBeDefined();
    expect(LINE_TYPE_COLORS['Prime tower']).toBeDefined();
    expect(LINE_TYPE_COLORS['Travel']).toBeDefined();
  });
});

describe('formatShortTime', () => {
  it('formats sub-minute durations as seconds', () => {
    expect(formatShortTime(7)).toBe('7s');
  });

  it('formats minute-scale durations as Nm Ns', () => {
    expect(formatShortTime(188)).toBe('3m8s');
  });

  it('formats hour-scale durations as Nh Nm', () => {
    expect(formatShortTime(3600 + 17 * 60)).toBe('1h17m');
  });

  it('returns empty string for zero/negative durations', () => {
    expect(formatShortTime(0)).toBe('');
    expect(formatShortTime(-5)).toBe('');
  });
});

describe('formatDuration / formatFilamentMeters / formatWeightGrams', () => {
  it('formats null values as a dash', () => {
    expect(formatDuration(null)).toBe('-');
    expect(formatFilamentMeters(null)).toBe('-');
    expect(formatWeightGrams(null)).toBe('-');
  });

  it('formats filament meters to 2 decimal places with unit', () => {
    expect(formatFilamentMeters(1.37456)).toBe('1.37 m');
  });

  it('formats weight grams to 2 decimal places with unit', () => {
    expect(formatWeightGrams(4.1932)).toBe('4.19g');
  });
});
