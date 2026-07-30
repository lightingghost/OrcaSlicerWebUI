/**
 * parameterSlice tests
 *
 * Focused on getEffectiveValueForTarget's "changed"/isOverriddenAtTarget
 * computation, which drives ParameterField's Reset button.
 *
 * Regression coverage for the reported bug: after adding a post_process
 * value in the Process panel and saving it into the process config, the
 * field kept showing as "changed" (Reset button visible) even after
 * reloading/reselecting the just-saved config — because the "changed"
 * check only asked "does this key exist in `overrides`" instead of
 * "does this key's override value differ from the CURRENT baseline
 * (profileDefaults)". Saving+reselecting updates profileDefaults to the
 * new value but never clears the now-redundant entry from `overrides`,
 * so the old presence-only check kept reporting it as overridden forever.
 */

import { describe, it, expect } from 'vitest';
import { create } from 'zustand';
import { createParameterSlice, ParameterSlice, ParameterDescriptor } from './parameterSlice';

function makeStore() {
  return create<ParameterSlice>()((...a) => createParameterSlice(...a));
}

const POST_PROCESS_DESCRIPTOR: ParameterDescriptor = {
  key: 'post_process',
  label: 'Post-processing scripts',
  tooltip: 'Scripts to run after slicing',
  type: 'string',
  default_value: '',
  section: 'other',
};

const BOOL_DESCRIPTOR: ParameterDescriptor = {
  key: 'enable_support',
  label: 'Enable support',
  tooltip: 'Generate support structures',
  type: 'bool',
  default_value: false,
  section: 'support',
};

describe('parameterSlice - getEffectiveValueForTarget "changed" detection', () => {
  it('reports isOverriddenAtTarget=true when the override differs from the current default', () => {
    const store = makeStore();
    store.getState().setOverride('post_process', '/scripts/addMD5.sh');

    const { isOverriddenAtTarget, value } = store
      .getState()
      .getEffectiveValueForTarget(POST_PROCESS_DESCRIPTOR, 'global');

    expect(value).toBe('/scripts/addMD5.sh');
    expect(isOverriddenAtTarget).toBe(true);
  });

  it(
    'reports isOverriddenAtTarget=false once profileDefaults is updated to match ' +
      'the override value (the exact reported bug: saving + reselecting a process ' +
      'config that now includes the edited value must clear the "changed" indicator)',
    () => {
      const store = makeStore();

      // User edits post_process in the panel — goes into `overrides`.
      store.getState().setOverride('post_process', '/scripts/addMD5.sh');
      expect(
        store.getState().getEffectiveValueForTarget(POST_PROCESS_DESCRIPTOR, 'global')
          .isOverriddenAtTarget
      ).toBe(true);

      // Save + reselect the saved config: profileSlice.selectProcessProfile
      // rebuilds profileDefaults from the resolved config, which now
      // includes the user's own saved post_process value. Nothing clears
      // `overrides` (by design — see profileSlice.ts's doc comments), so
      // the stale entry is still present.
      store.getState().setProfileDefaults({ post_process: '/scripts/addMD5.sh' });

      const { isOverriddenAtTarget, value } = store
        .getState()
        .getEffectiveValueForTarget(POST_PROCESS_DESCRIPTOR, 'global');

      expect(value).toBe('/scripts/addMD5.sh');
      expect(isOverriddenAtTarget).toBe(false);
    }
  );

  it('reports isOverriddenAtTarget=true again if the override diverges from the new baseline', () => {
    const store = makeStore();
    store.getState().setOverride('post_process', '/scripts/addMD5.sh');
    store.getState().setProfileDefaults({ post_process: '/scripts/addMD5.sh' });
    expect(
      store.getState().getEffectiveValueForTarget(POST_PROCESS_DESCRIPTOR, 'global')
        .isOverriddenAtTarget
    ).toBe(false);

    // User edits it again to something else — now overrides & profileDefaults disagree.
    store.getState().setOverride('post_process', '/scripts/other.sh');

    expect(
      store.getState().getEffectiveValueForTarget(POST_PROCESS_DESCRIPTOR, 'global')
        .isOverriddenAtTarget
    ).toBe(true);
  });

  it('treats boolean overrides as equal to their string profile-default equivalents ("1"/"0")', () => {
    const store = makeStore();
    store.getState().setOverride('enable_support', true);
    // A resolved profile JSON stores booleans as "1"/"0" strings (see
    // profileSlice.ts's coerceProfileValue) — but ParameterField writes
    // typed booleans into overrides via its checkbox handler, so the
    // comparison must treat these as equal rather than as a type mismatch.
    store.getState().setProfileDefaults({ enable_support: '1' });

    expect(
      store.getState().getEffectiveValueForTarget(BOOL_DESCRIPTOR, 'global').isOverriddenAtTarget
    ).toBe(false);
  });

  it('falls back to the descriptor default_value when profileDefaults has no entry for the key', () => {
    const store = makeStore();
    store.getState().setOverride('post_process', '/scripts/addMD5.sh');
    // profileDefaults never populated for this key.
    const { isOverriddenAtTarget } = store
      .getState()
      .getEffectiveValueForTarget(POST_PROCESS_DESCRIPTOR, 'global');
    // default_value is '' — override clearly differs from it.
    expect(isOverriddenAtTarget).toBe(true);
  });

  it('per-object target: own override is compared against the effective default the same way', () => {
    const store = makeStore();
    store.getState().setObjectOverride('file-1', 'post_process', '/scripts/addMD5.sh');
    store.getState().setProfileDefaults({ post_process: '/scripts/addMD5.sh' });

    const { isOverriddenAtTarget, value } = store
      .getState()
      .getEffectiveValueForTarget(POST_PROCESS_DESCRIPTOR, 'file-1');

    expect(value).toBe('/scripts/addMD5.sh');
    expect(isOverriddenAtTarget).toBe(false);
  });

  it('per-object target: inherited global override never counts as overridden at this target', () => {
    const store = makeStore();
    store.getState().setOverride('post_process', '/scripts/addMD5.sh');

    const { isOverriddenAtTarget, value } = store
      .getState()
      .getEffectiveValueForTarget(POST_PROCESS_DESCRIPTOR, 'file-1');

    // Inherits Global's value, but isOverriddenAtTarget reflects only
    // THIS object's own override (none set) — matches pre-existing
    // behavior, unaffected by this fix.
    expect(value).toBe('/scripts/addMD5.sh');
    expect(isOverriddenAtTarget).toBe(false);
  });
});
