/**
 * profileSlice tests
 *
 * Focused on selectProcessProfile: verifies that selecting a process
 * profile fetches its fully resolved configuration (inherits chain merged)
 * and applies it to parameterSlice's overrides, so the parameter panel
 * reflects the selected profile's actual values instead of just the
 * PrintConfig.cpp defaults.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { create } from 'zustand';
import { createProfileSlice, ProfileSlice, ProfileEntry } from './profileSlice';
import { createParameterSlice, ParameterSlice, ParameterDescriptor } from './parameterSlice';

type TestStore = ProfileSlice & ParameterSlice;

function makeStore() {
  return create<TestStore>()((...a) => ({
    ...createProfileSlice(...a),
    ...createParameterSlice(...a),
  }));
}

const DESCRIPTORS: ParameterDescriptor[] = [
  {
    key: 'layer_height',
    label: 'Layer height',
    tooltip: 'Height of each layer',
    type: 'float',
    default_value: 0,
    section: 'quality',
  },
  {
    key: 'line_width',
    label: 'Default',
    tooltip: 'Default line width',
    type: 'float',
    default_value: 0,
    section: 'quality',
  },
  {
    key: 'seam_position',
    label: 'Seam position',
    tooltip: 'Seam position',
    type: 'enum',
    default_value: 'nearest',
    enum_values: ['nearest', 'aligned', 'aligned_back', 'back', 'random'],
    section: 'quality',
  },
  {
    key: 'enable_support',
    label: 'Enable support',
    tooltip: 'Enable support generation',
    type: 'bool',
    default_value: false,
    section: 'support',
  },
];

const PROFILE: ProfileEntry = {
  name: '0.20mm Standard @Flashforge AD5M 0.4 Nozzle',
  path: 'Flashforge/process/0.20mm Standard @Flashforge AD5M 0.4 Nozzle.json',
  category: 'process',
};

describe('profileSlice - selectProcessProfile', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('fetches the resolved profile config and applies it to parameter overrides', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        layer_height: '0.2',
        line_width: '0.42',
        seam_position: 'aligned',
        enable_support: '1',
      }),
    });

    const store = makeStore();
    store.setState({ parameterDescriptors: DESCRIPTORS });

    await store.getState().selectProcessProfile(PROFILE);

    expect(global.fetch).toHaveBeenCalledWith(
      `/api/profiles/${PROFILE.path}/resolved`,
      expect.any(Object)
    );

    // Profile-loaded values become `profileDefaults` (the effective
    // default shown to the user and used by Reset), not user `overrides`.
    const { profileDefaults, overrides, selectedProcessProfile } = store.getState();
    expect(selectedProcessProfile).toEqual(PROFILE);
    expect(profileDefaults.layer_height).toBe(0.2);
    expect(profileDefaults.line_width).toBe(0.42);
    expect(profileDefaults.seam_position).toBe('aligned');
    expect(profileDefaults.enable_support).toBe(true);
    // No user overrides should have been created by loading a profile.
    expect(overrides).toEqual({});
  });

  it('reflects the loaded profile via getEffectiveDefault when no user override exists', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        layer_height: '0.2',
      }),
    });

    const store = makeStore();
    store.setState({ parameterDescriptors: DESCRIPTORS });

    await store.getState().selectProcessProfile(PROFILE);

    const layerHeightDescriptor = DESCRIPTORS.find((d) => d.key === 'layer_height')!;
    expect(store.getState().getEffectiveDefault(layerHeightDescriptor)).toBe(0.2);
  });

  it('replaces profileDefaults wholesale so keys not present in the new profile fall back to the global default', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        layer_height: '0.2',
      }),
    });

    const store = makeStore();
    store.setState({
      parameterDescriptors: DESCRIPTORS,
      profileDefaults: { line_width: 0.99, layer_height: 0.5 },
    });

    await store.getState().selectProcessProfile(PROFILE);

    const { profileDefaults } = store.getState();
    // line_width is not in the new profile's resolved config, so its stale
    // profile-derived default should be cleared entirely (falls back to
    // the descriptor's global default_value via getEffectiveDefault).
    expect(profileDefaults.line_width).toBeUndefined();
    // layer_height is present in the new profile and should be updated.
    expect(profileDefaults.layer_height).toBe(0.2);
  });

  it('does not throw and leaves state usable when the resolved fetch fails', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
    });

    const store = makeStore();
    store.setState({ parameterDescriptors: DESCRIPTORS });

    await expect(store.getState().selectProcessProfile(PROFILE)).resolves.toBeUndefined();
    expect(store.getState().selectedProcessProfile).toEqual(PROFILE);
  });

  it('ignores keys in the resolved config that have no matching descriptor', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        layer_height: '0.2',
        some_unrelated_internal_key: 'whatever',
      }),
    });

    const store = makeStore();
    store.setState({ parameterDescriptors: DESCRIPTORS });

    await store.getState().selectProcessProfile(PROFILE);

    const { profileDefaults } = store.getState();
    expect(profileDefaults.layer_height).toBe(0.2);
    expect(profileDefaults).not.toHaveProperty('some_unrelated_internal_key');
  });

  it('coerces array-valued profile settings by using the first element', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        layer_height: ['0.2'],
      }),
    });

    const store = makeStore();
    store.setState({ parameterDescriptors: DESCRIPTORS });

    await store.getState().selectProcessProfile(PROFILE);

    expect(store.getState().profileDefaults.layer_height).toBe(0.2);
  });
});
