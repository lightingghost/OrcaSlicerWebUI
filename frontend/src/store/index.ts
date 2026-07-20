import { create } from 'zustand';
import { FileSlice, createFileSlice } from './fileSlice';
import { ProfileSlice, createProfileSlice } from './profileSlice';
import { JobSlice, createJobSlice } from './jobSlice';
import { ParameterSlice, createParameterSlice } from './parameterSlice';
import { TransformSlice, createTransformSlice } from './transformSlice';
import { ViewportSlice, createViewportSlice } from './viewportSlice';
import { MiscSlice, createMiscSlice } from './miscSlice';
import { ActionSlice, createActionSlice } from './actionSlice';

export type StoreState = FileSlice &
  ProfileSlice &
  JobSlice &
  ParameterSlice &
  TransformSlice &
  ViewportSlice &
  MiscSlice &
  ActionSlice;

export const useStore = create<StoreState>()((...a) => ({
  ...createFileSlice(...a),
  ...createProfileSlice(...a),
  ...createJobSlice(...a),
  ...createParameterSlice(...a),
  ...createTransformSlice(...a),
  ...createViewportSlice(...a),
  ...createMiscSlice(...a),
  ...createActionSlice(...a),
}));

// Export individual slice types and interfaces for convenience
export type { FileSlice, UploadedFile } from './fileSlice';
export type { ProfileSlice, ProfileEntry } from './profileSlice';
export type {
  JobSlice,
  JobStatus,
  JobRecord,
  JobRequest,
  ProgressUpdateEvent,
  OutputFileSummary,
} from './jobSlice';
export type { ParameterSlice, ParameterDescriptor } from './parameterSlice';
export type { TransformSlice, TransformOptions } from './transformSlice';
export type { ViewportSlice, BoundingBox, ModelMetadata } from './viewportSlice';
export type { MiscSlice, MiscOptions, MiscValidationErrors } from './miscSlice';
export type { ActionSlice, Action, ActionFlags } from './actionSlice';
export { validateParameter } from '../lib/validation';
