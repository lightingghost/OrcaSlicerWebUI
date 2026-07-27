import { create } from 'zustand';
import { FileSlice, createFileSlice } from './fileSlice';
import { ProfileSlice, createProfileSlice } from './profileSlice';
import { JobSlice, createJobSlice } from './jobSlice';
import { ParameterSlice, createParameterSlice } from './parameterSlice';
import { TransformSlice, createTransformSlice } from './transformSlice';
import { ViewportSlice, createViewportSlice } from './viewportSlice';
import { MiscSlice, createMiscSlice } from './miscSlice';
import { ActionSlice, createActionSlice } from './actionSlice';
import { ObjectManipulationSlice, createObjectManipulationSlice } from './objectManipulationSlice';
import { ArrangeSettingsSlice, createArrangeSettingsSlice } from './arrangeSettingsSlice';
import { ContextMenuSlice, createContextMenuSlice } from './contextMenuSlice';
import { PreviewSlice, createPreviewSlice } from './previewSlice';
import { DeviceSlice, createDeviceSlice } from './deviceSlice';
import { ProjectSlice, createProjectSlice } from './projectSlice';

export type StoreState = FileSlice &
  ProfileSlice &
  JobSlice &
  ParameterSlice &
  TransformSlice &
  ViewportSlice &
  MiscSlice &
  ActionSlice &
  ObjectManipulationSlice &
  ArrangeSettingsSlice &
  ContextMenuSlice &
  PreviewSlice &
  DeviceSlice &
  ProjectSlice;

export const useStore = create<StoreState>()((...a) => ({
  ...createFileSlice(...a),
  ...createProfileSlice(...a),
  ...createJobSlice(...a),
  ...createParameterSlice(...a),
  ...createTransformSlice(...a),
  ...createViewportSlice(...a),
  ...createMiscSlice(...a),
  ...createActionSlice(...a),
  ...createObjectManipulationSlice(...a),
  ...createArrangeSettingsSlice(...a),
  ...createContextMenuSlice(...a),
  ...createPreviewSlice(...a),
  ...createDeviceSlice(...a),
  ...createProjectSlice(...a),
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
export { findGcodeOutput } from './jobSlice';
export type { ParameterSlice, ParameterDescriptor } from './parameterSlice';
export type { TransformSlice, TransformOptions } from './transformSlice';
export type { ViewportSlice, BoundingBox, ModelMetadata } from './viewportSlice';
export type { CoordinateMode, ObjectTransformSnapshot } from '../lib/objectTransform';
export type { MiscSlice, MiscOptions, MiscValidationErrors } from './miscSlice';
export type { ActionSlice, Action, ActionFlags } from './actionSlice';
export type {
  ObjectManipulationSlice,
  TransformTool,
  PendingTransformCommand,
} from './objectManipulationSlice';
export type {
  ArrangeSettingsSlice,
  ArrangeSettingsState,
} from './arrangeSettingsSlice';
export { DEFAULT_ARRANGE_SETTINGS } from './arrangeSettingsSlice';
export type { ContextMenuSlice, ContextMenuState } from './contextMenuSlice';
export type { PreviewSlice, MainTab } from './previewSlice';
export type { DeviceSlice, DeviceConnection, HostType, PrinterAgent, UploadJobResult } from './deviceSlice';
export type {
  ProjectSlice,
  PlateObjectPlacement,
  ImportedProjectObject,
  ProjectExportObject,
} from './projectSlice';
export { validateParameter } from '../lib/validation';
