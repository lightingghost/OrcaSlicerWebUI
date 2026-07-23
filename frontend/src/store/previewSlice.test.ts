import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPreviewSlice, PreviewSlice } from './previewSlice';
import sampleGcode from '../lib/__fixtures__/sample.gcode?raw';

// Mock fetch globally
global.fetch = vi.fn();

function createTestSlice() {
  let state: PreviewSlice;
  const listeners: Array<() => void> = [];
  const set = (updater: Partial<PreviewSlice> | ((s: PreviewSlice) => Partial<PreviewSlice>)) => {
    const partial = typeof updater === 'function' ? updater(state) : updater;
    state = { ...state, ...partial };
    listeners.forEach((l) => l());
  };
  const get = () => state;
  state = createPreviewSlice(set as any, get as any, undefined as any);
  return { get, set };
}

describe('previewSlice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('api_token', 'test-token');
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('defaults to the prepare tab', () => {
    const { get } = createTestSlice();
    expect(get().activeTab).toBe('prepare');
  });

  it('setActiveTab switches tabs', () => {
    const { get } = createTestSlice();
    get().setActiveTab('preview');
    expect(get().activeTab).toBe('preview');
  });

  it('starts with no parsed gcode', () => {
    const { get } = createTestSlice();
    expect(get().parsedGcode).toBeNull();
    expect(get().isLoadingGcode).toBe(false);
    expect(get().gcodeLoadError).toBeNull();
  });

  it('loadGcodePreview fetches, parses, and stores the gcode, defaulting to the last layer fully drawn', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      text: async () => sampleGcode,
    });

    const { get } = createTestSlice();
    await get().loadGcodePreview('/api/jobs/job-1/outputs/plate_1.gcode');

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/jobs/job-1/outputs/plate_1.gcode',
      expect.objectContaining({
        headers: { Authorization: 'Bearer test-token' },
      })
    );

    const state = get();
    expect(state.isLoadingGcode).toBe(false);
    expect(state.parsedGcode).not.toBeNull();
    expect(state.gcodeLoadError).toBeNull();

    const lastLayerIndex = state.parsedGcode!.layers.length - 1;
    expect(state.currentLayerIndex).toBe(lastLayerIndex);
    const lastLayer = state.parsedGcode!.layers[lastLayerIndex];
    expect(state.currentStepIndex).toBe(lastLayer.endSegmentIndex - lastLayer.startSegmentIndex);
  });

  it('loadGcodePreview surfaces an error when the fetch fails', async () => {
    (global.fetch as any).mockResolvedValueOnce({ ok: false, status: 404 });

    const { get } = createTestSlice();
    await get().loadGcodePreview('/api/jobs/job-1/outputs/plate_1.gcode');

    const state = get();
    expect(state.isLoadingGcode).toBe(false);
    expect(state.parsedGcode).toBeNull();
    expect(state.gcodeLoadError).toMatch(/404/);
  });

  it('clearGcodePreview resets all preview state', async () => {
    (global.fetch as any).mockResolvedValueOnce({ ok: true, text: async () => sampleGcode });

    const { get } = createTestSlice();
    await get().loadGcodePreview('/api/jobs/job-1/outputs/plate_1.gcode');
    expect(get().parsedGcode).not.toBeNull();

    get().clearGcodePreview();
    expect(get().parsedGcode).toBeNull();
    expect(get().gcodeLoadError).toBeNull();
    expect(get().currentLayerIndex).toBe(0);
    expect(get().currentStepIndex).toBe(0);
  });

  it('setCurrentLayerIndex clamps to valid layer bounds and resets the step index to that layer size', async () => {
    (global.fetch as any).mockResolvedValueOnce({ ok: true, text: async () => sampleGcode });
    const { get } = createTestSlice();
    await get().loadGcodePreview('/api/jobs/job-1/outputs/plate_1.gcode');

    const layerCount = get().parsedGcode!.layers.length;

    get().setCurrentLayerIndex(0);
    expect(get().currentLayerIndex).toBe(0);
    const firstLayer = get().parsedGcode!.layers[0];
    expect(get().currentStepIndex).toBe(firstLayer.endSegmentIndex - firstLayer.startSegmentIndex);

    // Out-of-range values clamp to the valid range instead of throwing.
    get().setCurrentLayerIndex(-5);
    expect(get().currentLayerIndex).toBe(0);

    get().setCurrentLayerIndex(layerCount + 100);
    expect(get().currentLayerIndex).toBe(layerCount - 1);
  });

  it('setCurrentStepIndex clamps to the current layer step bounds', async () => {
    (global.fetch as any).mockResolvedValueOnce({ ok: true, text: async () => sampleGcode });
    const { get } = createTestSlice();
    await get().loadGcodePreview('/api/jobs/job-1/outputs/plate_1.gcode');

    get().setCurrentLayerIndex(0);
    const layer = get().parsedGcode!.layers[0];
    const maxStep = layer.endSegmentIndex - layer.startSegmentIndex;

    get().setCurrentStepIndex(-10);
    expect(get().currentStepIndex).toBe(0);

    get().setCurrentStepIndex(maxStep + 1000);
    expect(get().currentStepIndex).toBe(maxStep);

    get().setCurrentStepIndex(1);
    expect(get().currentStepIndex).toBe(1);
  });
});
