import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useStore, validateParameter } from './index';
import type { UploadedFile, ProfileEntry, ParameterDescriptor, JobStatus } from './index';

// Mock fetch globally
global.fetch = vi.fn();

// Mock WebSocket
global.WebSocket = vi.fn(() => ({
  close: vi.fn(),
  send: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
  onopen: null,
  onclose: null,
  onerror: null,
  onmessage: null,
})) as any;

// Mock localStorage
global.localStorage = {
  getItem: vi.fn(() => 'test-token'),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn(),
};

describe('Zustand Store Slices', () => {
  beforeEach(() => {
    // Reset store before each test
    const state = useStore.getState();
    state.uploadedFiles = [];
    state.uploadError = null;
    state.activeJobId = null;
    state.jobStatus = null;
    state.queuePosition = null;
    state.progress = null;
    state.outputFiles = [];
    state.jobs = [];
    state.parameterDescriptors = [];
    state.overrides = {};
    state.validationErrors = {};
    state.transforms = {
      rotate: 0,
      rotate_x: 0,
      rotate_y: 0,
      scale: 1,
      // Default is 0 (disabled) — Arrange is a separate, explicit,
      // real-CLI-backed action (see ViewportTransformToolbar's Arrange
      // button), so Slice no longer silently re-arranges by default. See
      // transformSlice.ts's comment on why.
      arrange: 0,
      orient: 0,
      repetitions: 1,
      // Default is true, not native CLI's own false — see
      // transformSlice.ts's comment on why.
      ensure_on_bed: true,
      assemble: false,
      convert_unit: false,
    };
    state.modelBounds = null;
    state.isOutOfBounds = false;
    state.selectedObjectId = null;
    state.activeTransformTool = 'move';
    state.isManipulationPanelOpen = false;
    state.isInfoOverlayOpen = true;
    state.coordinateMode = 'world';
    state.uniformScale = true;
    state.objectTransformSnapshot = null;
    state.pendingTransformCommand = null;
    state.isLayOnFacePickModeActive = false;
    state.arrangeSettings = {
      spacing: 0,
      enableRotation: false,
      allowMultiMaterialsOnSamePlate: true,
      alignToYAxis: false,
    };
    state.isArrangeSettingsOpen = false;
    state.arrangeRequestId = 0;
    state.contextMenu = { isOpen: false, position: { x: 0, y: 0 }, targetFileId: null };
    
    // Clear all mocks
    vi.clearAllMocks();
  });

  describe('FileSlice', () => {
    it('should have initial state', () => {
      const state = useStore.getState();
      expect(state.uploadedFiles).toEqual([]);
      expect(state.uploadError).toBeNull();
    });

    it('should have uploadFile function', () => {
      const state = useStore.getState();
      expect(typeof state.uploadFile).toBe('function');
    });

    it('should have removeFile function', () => {
      const state = useStore.getState();
      expect(typeof state.removeFile).toBe('function');
    });

    it('should update uploadedFiles when file is added', async () => {
      const mockFile: UploadedFile = {
        file_id: 'test-file-123',
        filename: 'test.stl',
        size_bytes: 1024,
        extension: 'stl',
        uploaded_at: '2024-01-01T00:00:00Z',
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockFile,
      });

      const file = new File(['test'], 'test.stl', { type: 'application/octet-stream' });

      await useStore.getState().uploadFile(file);

      const state = useStore.getState();
      expect(state.uploadedFiles).toHaveLength(1);
      // uploadFile enriches the raw upload response with source_file_id
      // (== its own file_id for a genuine upload) and is_clone: false.
      expect(state.uploadedFiles[0]).toEqual({
        ...mockFile,
        source_file_id: mockFile.file_id,
        is_clone: false,
      });
      expect(state.uploadError).toBeNull();
    });

    it('should set error when upload fails', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 422,
        json: async () => ({ error: 'Invalid file type' }),
      });

      const file = new File(['test'], 'test.xyz', { type: 'application/octet-stream' });

      try {
        await useStore.getState().uploadFile(file);
      } catch (error) {
        // Expected to throw
      }

      const state = useStore.getState();
      expect(state.uploadError).toBe('Invalid file type');
    });

    it('should remove file from uploadedFiles', () => {
      // Manually add a file to test removal
      useStore.setState({
        uploadedFiles: [
          {
            file_id: 'file-1',
            filename: 'test.stl',
            size_bytes: 1024,
            extension: 'stl',
            uploaded_at: '2024-01-01T00:00:00Z',
          },
        ],
      });

      // removeFile now also fires a fire-and-forget autosave-cleanup
      // request (deleting this object's process_config_object_{file_id}
      // autosave) in addition to the backend file delete, so every fetch
      // call needs a resolved response.
      (global.fetch as any).mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });

      useStore.getState().removeFile('file-1');

      const state = useStore.getState();
      expect(state.uploadedFiles).toHaveLength(0);
    });
  });

  describe('ProfileSlice', () => {
    it('should have initial state', () => {
      const state = useStore.getState();
      expect(state.manufacturers).toEqual([]);
      expect(state.selectedManufacturer).toBeNull();
      expect(state.printerProfiles).toEqual([]);
      expect(state.processProfiles).toEqual([]);
      expect(state.filamentProfiles).toEqual([]);
      expect(state.selectedPrinterProfile).toBeNull();
      expect(state.selectedProcessProfile).toBeNull();
      expect(state.selectedFilamentProfiles).toEqual([]);
      expect(state.bedSize).toBeNull();
    });

    it('should toggle filament profile selection', () => {
      const profile: ProfileEntry = {
        name: 'PLA',
        path: 'manufacturer/filament/PLA.json',
        category: 'filament',
      };

      // Add profile
      useStore.getState().toggleFilamentProfile(profile);
      expect(useStore.getState().selectedFilamentProfiles).toHaveLength(1);
      expect(useStore.getState().selectedFilamentProfiles[0]).toEqual(profile);

      // Remove profile
      useStore.getState().toggleFilamentProfile(profile);
      expect(useStore.getState().selectedFilamentProfiles).toHaveLength(0);
    });

    it('should handle multiple filament profiles', () => {
      const profile1: ProfileEntry = {
        name: 'PLA',
        path: 'manufacturer/filament/PLA.json',
        category: 'filament',
      };
      const profile2: ProfileEntry = {
        name: 'ABS',
        path: 'manufacturer/filament/ABS.json',
        category: 'filament',
      };

      useStore.getState().toggleFilamentProfile(profile1);
      useStore.getState().toggleFilamentProfile(profile2);

      expect(useStore.getState().selectedFilamentProfiles).toHaveLength(2);
      
      // Remove only profile1
      useStore.getState().toggleFilamentProfile(profile1);
      expect(useStore.getState().selectedFilamentProfiles).toHaveLength(1);
      expect(useStore.getState().selectedFilamentProfiles[0]).toEqual(profile2);
    });

    it('should set printer profile', () => {
      const profile: ProfileEntry = {
        name: 'Printer X',
        path: 'manufacturer/machine/PrinterX.json',
        category: 'machine',
      };

      useStore.getState().selectPrinterProfile(profile);
      expect(useStore.getState().selectedPrinterProfile).toEqual(profile);
    });

    it('should set process profile', () => {
      const profile: ProfileEntry = {
        name: 'Fast',
        path: 'manufacturer/process/fast.json',
        category: 'process',
      };

      useStore.getState().selectProcessProfile(profile);
      expect(useStore.getState().selectedProcessProfile).toEqual(profile);
    });
  });

  describe('JobSlice - State Machine', () => {
    it('should have initial state', () => {
      const state = useStore.getState();
      expect(state.activeJobId).toBeNull();
      expect(state.jobStatus).toBeNull();
      expect(state.queuePosition).toBeNull();
      expect(state.progress).toBeNull();
      expect(state.outputFiles).toEqual([]);
      expect(state.jobs).toEqual([]);
    });

    it('should transition from null to queued state', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          job_id: 'job-123',
          status: 'queued',
        }),
      });

      await useStore.getState().submitJob({
        file_ids: ['file-1'],
        printer_profile_path: 'printer.json',
        process_profile_path: 'process.json',
        filament_profile_paths: ['filament.json'],
        action: 'slice',
      });

      const state = useStore.getState();
      expect(state.activeJobId).toBe('job-123');
      expect(state.jobStatus).toBe('queued');
    });

    it('should transition from queued to running state', () => {
      useStore.setState({
        activeJobId: 'job-123',
        jobStatus: 'queued',
        queuePosition: 2,
      });

      // Simulate WebSocket message
      useStore.setState({
        jobStatus: 'running',
        queuePosition: null,
      });

      const state = useStore.getState();
      expect(state.jobStatus).toBe('running');
      expect(state.queuePosition).toBeNull();
    });

    it('should transition from running to completed state', () => {
      useStore.setState({
        activeJobId: 'job-123',
        jobStatus: 'running',
      });

      useStore.setState({
        jobStatus: 'completed',
        outputFiles: [
          {
            filename: 'output.gcode',
            size_bytes: 5000,
            download_url: '/api/jobs/job-123/outputs/output.gcode',
          },
        ],
      });

      const state = useStore.getState();
      expect(state.jobStatus).toBe('completed');
      expect(state.outputFiles).toHaveLength(1);
      expect(state.outputFiles[0].filename).toBe('output.gcode');
    });

    it('should transition from running to failed state', () => {
      useStore.setState({
        activeJobId: 'job-123',
        jobStatus: 'running',
      });

      useStore.setState({
        jobStatus: 'failed',
      });

      const state = useStore.getState();
      expect(state.jobStatus).toBe('failed');
    });

    it('should transition from running to timed_out state', () => {
      useStore.setState({
        activeJobId: 'job-123',
        jobStatus: 'running',
      });

      useStore.setState({
        jobStatus: 'timed_out',
      });

      const state = useStore.getState();
      expect(state.jobStatus).toBe('timed_out');
    });

    it('should handle job management functions', () => {
      const state = useStore.getState();
      expect(typeof state.submitJob).toBe('function');
      expect(typeof state.cancelJob).toBe('function');
      expect(typeof state.fetchJobHistory).toBe('function');
      expect(typeof state.connectProgressSocket).toBe('function');
      expect(typeof state.disconnectProgressSocket).toBe('function');
    });

    it('should update outputFiles when job completes', () => {
      const outputs = [
        {
          filename: 'plate_1.gcode',
          size_bytes: 5000,
          download_url: '/api/jobs/job-123/outputs/plate_1.gcode',
        },
        {
          filename: 'plate_2.gcode',
          size_bytes: 6000,
          download_url: '/api/jobs/job-123/outputs/plate_2.gcode',
        },
      ];

      useStore.setState({
        jobStatus: 'completed',
        outputFiles: outputs,
      });

      const state = useStore.getState();
      expect(state.outputFiles).toHaveLength(2);
      expect(state.outputFiles[0].filename).toBe('plate_1.gcode');
      expect(state.outputFiles[1].filename).toBe('plate_2.gcode');
    });
  });

  describe('ParameterSlice', () => {
    it('should have initial state', () => {
      const state = useStore.getState();
      expect(state.parameterDescriptors).toEqual([]);
      expect(state.overrides).toEqual({});
      expect(state.validationErrors).toEqual({});
    });

    it('should set and clear overrides', () => {
      useStore.getState().setOverride('layer_height', 0.2);
      expect(useStore.getState().overrides.layer_height).toBe(0.2);

      useStore.getState().clearOverride('layer_height');
      expect(useStore.getState().overrides.layer_height).toBeUndefined();
    });

    it('should handle multiple overrides', () => {
      useStore.getState().setOverride('layer_height', 0.2);
      useStore.getState().setOverride('infill_density', 20);
      useStore.getState().setOverride('support_enable', true);

      const state = useStore.getState();
      expect(state.overrides.layer_height).toBe(0.2);
      expect(state.overrides.infill_density).toBe(20);
      expect(state.overrides.support_enable).toBe(true);
    });

    it('should validate numeric parameters', () => {
      const descriptor: ParameterDescriptor = {
        key: 'layer_height',
        label: 'Layer Height',
        tooltip: 'Height of each layer',
        type: 'float',
        default_value: 0.2,
        min: 0.1,
        max: 0.4,
        section: 'quality',
      };

      // Valid value
      expect(validateParameter(descriptor, 0.2)).toBeNull();

      // Below minimum
      expect(validateParameter(descriptor, 0.05)).toBe('Value must be at least 0.1');

      // Above maximum
      expect(validateParameter(descriptor, 0.5)).toBe('Value must be at most 0.4');

      // Invalid type
      expect(validateParameter(descriptor, 'invalid')).toBe('Invalid float value');
    });

    it('should validate integer parameters', () => {
      const descriptor: ParameterDescriptor = {
        key: 'top_layers',
        label: 'Top Layers',
        tooltip: 'Number of top layers',
        type: 'int',
        default_value: 5,
        min: 1,
        max: 10,
        section: 'strength',
      };

      // Valid value
      expect(validateParameter(descriptor, 5)).toBeNull();

      // Float instead of int
      expect(validateParameter(descriptor, 5.5)).toBe('Value must be an integer');

      // Below minimum
      expect(validateParameter(descriptor, 0)).toBe('Value must be at least 1');

      // Above maximum
      expect(validateParameter(descriptor, 11)).toBe('Value must be at most 10');
    });

    it('should validate boolean parameters', () => {
      const descriptor: ParameterDescriptor = {
        key: 'support_enable',
        label: 'Enable Support',
        tooltip: 'Enable support structures',
        type: 'bool',
        default_value: false,
        section: 'support',
      };

      // Valid values
      expect(validateParameter(descriptor, true)).toBeNull();
      expect(validateParameter(descriptor, false)).toBeNull();

      // Invalid type
      expect(validateParameter(descriptor, 'true')).toBe('Value must be a boolean');
      expect(validateParameter(descriptor, 1)).toBe('Value must be a boolean');
    });

    it('should validate enum parameters', () => {
      const descriptor: ParameterDescriptor = {
        key: 'fill_pattern',
        label: 'Fill Pattern',
        tooltip: 'Infill pattern',
        type: 'enum',
        default_value: 'grid',
        enum_values: ['grid', 'lines', 'cubic', 'honeycomb'],
        section: 'strength',
      };

      // Valid value
      expect(validateParameter(descriptor, 'grid')).toBeNull();
      expect(validateParameter(descriptor, 'honeycomb')).toBeNull();

      // Invalid value
      expect(validateParameter(descriptor, 'invalid_pattern')).toContain('must be one of');
    });

    it('should validate string parameters', () => {
      const descriptor: ParameterDescriptor = {
        key: 'printer_name',
        label: 'Printer Name',
        tooltip: 'Name of the printer',
        type: 'string',
        default_value: '',
        section: 'other',
      };

      // Valid value
      expect(validateParameter(descriptor, 'My Printer')).toBeNull();
      expect(validateParameter(descriptor, '')).toBeNull();

      // Invalid type
      expect(validateParameter(descriptor, 123)).toBe('Value must be a string');
    });

    it('should update validation errors when setOverride is called', () => {
      const descriptor: ParameterDescriptor = {
        key: 'layer_height',
        label: 'Layer Height',
        tooltip: 'Height of each layer',
        type: 'float',
        default_value: 0.2,
        min: 0.1,
        max: 0.4,
        section: 'quality',
      };

      useStore.setState({ parameterDescriptors: [descriptor] });

      // Set valid value
      useStore.getState().setOverride('layer_height', 0.2);
      expect(useStore.getState().validationErrors.layer_height).toBeUndefined();

      // Set invalid value
      useStore.getState().setOverride('layer_height', 0.05);
      expect(useStore.getState().validationErrors.layer_height).toBe('Value must be at least 0.1');
    });

    it('should validateAll and return false when there are errors', () => {
      const descriptors: ParameterDescriptor[] = [
        {
          key: 'layer_height',
          label: 'Layer Height',
          tooltip: 'Height of each layer',
          type: 'float',
          default_value: 0.2,
          min: 0.1,
          max: 0.4,
          section: 'quality',
        },
        {
          key: 'infill_density',
          label: 'Infill Density',
          tooltip: 'Infill density percentage',
          type: 'int',
          default_value: 20,
          min: 0,
          max: 100,
          section: 'strength',
        },
      ];

      useStore.setState({ parameterDescriptors: descriptors });

      // Set one valid and one invalid override
      useStore.getState().setOverride('layer_height', 0.2);
      useStore.getState().setOverride('infill_density', 150); // Invalid

      const isValid = useStore.getState().validateAll();

      expect(isValid).toBe(false);
      expect(useStore.getState().validationErrors.infill_density).toBe('Value must be at most 100');
    });

    it('should validateAll and return true when all overrides are valid', () => {
      const descriptors: ParameterDescriptor[] = [
        {
          key: 'layer_height',
          label: 'Layer Height',
          tooltip: 'Height of each layer',
          type: 'float',
          default_value: 0.2,
          min: 0.1,
          max: 0.4,
          section: 'quality',
        },
        {
          key: 'infill_density',
          label: 'Infill Density',
          tooltip: 'Infill density percentage',
          type: 'int',
          default_value: 20,
          min: 0,
          max: 100,
          section: 'strength',
        },
      ];

      useStore.setState({ parameterDescriptors: descriptors });

      // Set all valid overrides
      useStore.getState().setOverride('layer_height', 0.2);
      useStore.getState().setOverride('infill_density', 50);

      const isValid = useStore.getState().validateAll();

      expect(isValid).toBe(true);
      expect(Object.keys(useStore.getState().validationErrors)).toHaveLength(0);
    });
  });

  describe('TransformSlice', () => {
    it('should have initial state', () => {
      const state = useStore.getState();
      expect(state.transforms.rotate).toBe(0);
      expect(state.transforms.rotate_x).toBe(0);
      expect(state.transforms.rotate_y).toBe(0);
      expect(state.transforms.scale).toBe(1);
      // Default is 0 (disabled) — Arrange is a separate, explicit,
      // real-CLI-backed action (see ViewportTransformToolbar's Arrange
      // button), so Slice no longer silently re-arranges by default. See
      // transformSlice.ts's comment on why.
      expect(state.transforms.arrange).toBe(0);
      expect(state.transforms.orient).toBe(0);
      expect(state.transforms.repetitions).toBe(1);
      // ensure_on_bed defaults to true (not native CLI's own false default)
      // because this app never sends the viewport's on-screen object
      // position to the backend — the backend always slices the raw
      // uploaded file, so it must be told to reposition objects onto the
      // bed itself, matching what native's desktop GUI does automatically
      // and unconditionally on import (see transformSlice.ts's comment).
      expect(state.transforms.ensure_on_bed).toBe(true);
      expect(state.transforms.assemble).toBe(false);
      expect(state.transforms.convert_unit).toBe(false);
    });

    it('should set transform values', () => {
      useStore.getState().setTransform('rotate', 45);
      expect(useStore.getState().transforms.rotate).toBe(45);

      useStore.getState().setTransform('scale', 2);
      expect(useStore.getState().transforms.scale).toBe(2);

      useStore.getState().setTransform('rotate_x', 90);
      expect(useStore.getState().transforms.rotate_x).toBe(90);

      useStore.getState().setTransform('rotate_y', 180);
      expect(useStore.getState().transforms.rotate_y).toBe(180);
    });

    it('should set boolean transform flags', () => {
      useStore.getState().setTransform('ensure_on_bed', true);
      expect(useStore.getState().transforms.ensure_on_bed).toBe(true);

      useStore.getState().setTransform('assemble', true);
      expect(useStore.getState().transforms.assemble).toBe(true);

      useStore.getState().setTransform('convert_unit', true);
      expect(useStore.getState().transforms.convert_unit).toBe(true);
    });

    it('should set arrange and orient values', () => {
      useStore.getState().setTransform('arrange', 1);
      expect(useStore.getState().transforms.arrange).toBe(1);

      useStore.getState().setTransform('orient', 2);
      expect(useStore.getState().transforms.orient).toBe(2);
    });

    it('should set repetitions', () => {
      useStore.getState().setTransform('repetitions', 5);
      expect(useStore.getState().transforms.repetitions).toBe(5);
    });

    it('should reset transforms to default values', () => {
      // Set various transforms to non-default values first.
      useStore.getState().setTransform('rotate', 90);
      useStore.getState().setTransform('scale', 1.5);
      useStore.getState().setTransform('arrange', 2);
      useStore.getState().setTransform('ensure_on_bed', false);

      // Reset
      useStore.getState().resetTransforms();

      const state = useStore.getState();
      expect(state.transforms.rotate).toBe(0);
      expect(state.transforms.scale).toBe(1);
      // Defaults are arrange=0 (disabled) and ensure_on_bed=true — see
      // transformSlice.ts's comment on why.
      expect(state.transforms.arrange).toBe(0);
      expect(state.transforms.ensure_on_bed).toBe(true);
    });

    it('should handle arrange sub-options', () => {
      useStore.getState().setTransform('arrange', 1);
      useStore.getState().setTransform('allow_rotations', true);
      useStore.getState().setTransform('allow_multicolor_oneplate', true);
      useStore.getState().setTransform('avoid_extrusion_cali_region', true);

      const state = useStore.getState();
      expect(state.transforms.allow_rotations).toBe(true);
      expect(state.transforms.allow_multicolor_oneplate).toBe(true);
      expect(state.transforms.avoid_extrusion_cali_region).toBe(true);
    });
  });

  describe('ViewportSlice', () => {
    it('should have initial state', () => {
      const state = useStore.getState();
      expect(state.modelBounds).toBeNull();
      expect(state.isOutOfBounds).toBe(false);
      expect(state.selectedObjectId).toBeNull();
      expect(state.activeTransformTool).toBe('move');
    });

    it('should set selected object id', () => {
      useStore.getState().setSelectedObjectId('file-1');
      expect(useStore.getState().selectedObjectId).toBe('file-1');

      useStore.getState().setSelectedObjectId(null);
      expect(useStore.getState().selectedObjectId).toBeNull();
    });

    it('should set active transform tool', () => {
      useStore.getState().setActiveTransformTool('rotate');
      expect(useStore.getState().activeTransformTool).toBe('rotate');

      useStore.getState().setActiveTransformTool('scale');
      expect(useStore.getState().activeTransformTool).toBe('scale');

      useStore.getState().setActiveTransformTool('move');
      expect(useStore.getState().activeTransformTool).toBe('move');
    });

    it('should default the manipulation panel to closed and require an explicit open', () => {
      expect(useStore.getState().isManipulationPanelOpen).toBe(false);

      useStore.getState().setManipulationPanelOpen(true);
      expect(useStore.getState().isManipulationPanelOpen).toBe(true);

      useStore.getState().setManipulationPanelOpen(false);
      expect(useStore.getState().isManipulationPanelOpen).toBe(false);
    });

    it('should close the manipulation panel when a new object is selected', () => {
      useStore.getState().setManipulationPanelOpen(true);
      expect(useStore.getState().isManipulationPanelOpen).toBe(true);

      // Selecting any object (including a different one) must reset the
      // panel to closed rather than reopening with the last-used tool.
      useStore.getState().setSelectedObjectId('file-2');
      // Note: the panel-closing behavior on selection change lives in
      // ThreeViewport's effect (it needs the mesh refs), not the store
      // action itself, so we only assert the store's own default here.
      expect(useStore.getState().selectedObjectId).toBe('file-2');
    });

    it('should default the info overlay to open and support closing it', () => {
      expect(useStore.getState().isInfoOverlayOpen).toBe(true);

      useStore.getState().setInfoOverlayOpen(false);
      expect(useStore.getState().isInfoOverlayOpen).toBe(false);

      useStore.getState().setInfoOverlayOpen(true);
      expect(useStore.getState().isInfoOverlayOpen).toBe(true);
    });

    it('should default to world coordinates with uniform scale enabled', () => {
      const state = useStore.getState();
      expect(state.coordinateMode).toBe('world');
      expect(state.uniformScale).toBe(true);
    });

    it('should dispatch and clear a pending transform command', () => {
      useStore.getState().dispatchTransformCommand({ type: 'position', axis: 0, value: 5 });
      expect(useStore.getState().pendingTransformCommand).toEqual({
        type: 'position',
        axis: 0,
        value: 5,
      });

      useStore.getState().clearTransformCommand();
      expect(useStore.getState().pendingTransformCommand).toBeNull();
    });

    it('should default Lay on Face pick mode to inactive and support toggling it', () => {
      expect(useStore.getState().isLayOnFacePickModeActive).toBe(false);

      useStore.getState().setLayOnFacePickModeActive(true);
      expect(useStore.getState().isLayOnFacePickModeActive).toBe(true);

      useStore.getState().setLayOnFacePickModeActive(false);
      expect(useStore.getState().isLayOnFacePickModeActive).toBe(false);
    });

    it('should dispatch a layOnFace command with the target id and world normal', () => {
      useStore.getState().dispatchTransformCommand({
        type: 'layOnFace',
        targetId: 'file-1',
        worldNormal: [0, 0, 1],
      });
      expect(useStore.getState().pendingTransformCommand).toEqual({
        type: 'layOnFace',
        targetId: 'file-1',
        worldNormal: [0, 0, 1],
      });
    });

    it('should dispatch autoOrient commands for both "selected" and "all" scopes', () => {
      useStore.getState().dispatchTransformCommand({ type: 'autoOrient', scope: 'selected' });
      expect(useStore.getState().pendingTransformCommand).toEqual({
        type: 'autoOrient',
        scope: 'selected',
      });

      useStore.getState().dispatchTransformCommand({ type: 'autoOrient', scope: 'all' });
      expect(useStore.getState().pendingTransformCommand).toEqual({
        type: 'autoOrient',
        scope: 'all',
      });
    });

    it('should set model bounds', () => {
      const bounds = {
        min: { x: -10, y: -10, z: 0 },
        max: { x: 10, y: 10, z: 20 },
      };

      useStore.getState().setModelBounds(bounds);
      expect(useStore.getState().modelBounds).toEqual(bounds);
    });

    it('should handle different model bounds', () => {
      const bounds1 = {
        min: { x: -50, y: -50, z: 0 },
        max: { x: 50, y: 50, z: 100 },
      };

      useStore.getState().setModelBounds(bounds1);
      expect(useStore.getState().modelBounds).toEqual(bounds1);

      const bounds2 = {
        min: { x: -5, y: -5, z: 0 },
        max: { x: 5, y: 5, z: 10 },
      };

      useStore.getState().setModelBounds(bounds2);
      expect(useStore.getState().modelBounds).toEqual(bounds2);
    });
  });

  describe('FileSlice - Clone / Instance Count (right-click context menu)', () => {
    beforeEach(() => {
      useStore.setState({
        uploadedFiles: [
          {
            file_id: 'orig-1',
            filename: 'model.stl',
            size_bytes: 1000,
            extension: 'stl',
            uploaded_at: '2024-01-01',
            source_file_id: 'orig-1',
            is_clone: false,
          },
        ],
      });
      (global.fetch as any).mockResolvedValue({ ok: true });
    });

    it('duplicateObject adds exactly one clone referencing the same source_file_id', () => {
      const newId = useStore.getState().duplicateObject('orig-1');

      expect(newId).not.toBe('');
      const files = useStore.getState().uploadedFiles;
      expect(files).toHaveLength(2);
      const clone = files.find((f) => f.file_id === newId);
      expect(clone).toBeDefined();
      expect(clone!.is_clone).toBe(true);
      expect(clone!.source_file_id).toBe('orig-1');
    });

    it('duplicateObject returns empty string for an unknown file id', () => {
      const result = useStore.getState().duplicateObject('does-not-exist');
      expect(result).toBe('');
      expect(useStore.getState().uploadedFiles).toHaveLength(1);
    });

    it('setInstanceCount adds clones to reach the requested total', () => {
      const newIds = useStore.getState().setInstanceCount('orig-1', 3);

      expect(newIds).toHaveLength(2);
      const files = useStore.getState().uploadedFiles;
      expect(files).toHaveLength(3);
      expect(files.filter((f) => f.source_file_id === 'orig-1')).toHaveLength(3);
    });

    it('setInstanceCount removes clones (never the original) to reach a smaller total', () => {
      useStore.getState().setInstanceCount('orig-1', 4);
      expect(useStore.getState().uploadedFiles).toHaveLength(4);

      useStore.getState().setInstanceCount('orig-1', 2);
      const files = useStore.getState().uploadedFiles;
      expect(files).toHaveLength(2);
      expect(files.some((f) => f.file_id === 'orig-1' && !f.is_clone)).toBe(true);
    });

    it('setInstanceCount clamps to a minimum of 1 and never removes the original', () => {
      useStore.getState().setInstanceCount('orig-1', 3);
      useStore.getState().setInstanceCount('orig-1', 0);

      const files = useStore.getState().uploadedFiles;
      expect(files).toHaveLength(1);
      expect(files[0].file_id).toBe('orig-1');
    });

    it('setInstanceCount is a no-op when the count already matches', () => {
      const result = useStore.getState().setInstanceCount('orig-1', 1);
      expect(result).toEqual([]);
      expect(useStore.getState().uploadedFiles).toHaveLength(1);
    });

    it('removeFile only issues a backend file delete once no sibling instance remains', () => {
      const fetchSpy = global.fetch as any;
      fetchSpy.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
      useStore.getState().duplicateObject('orig-1'); // now 2 instances of orig-1
      fetchSpy.mockClear();

      // Removing one of two instances should NOT trigger a backend FILE
      // delete (a sibling still needs the same source file) — it does
      // still fire a per-object autosave-cleanup request for that
      // instance's own file_id, since per-object process overrides are
      // keyed per plate instance, not per source file.
      const files = useStore.getState().uploadedFiles;
      const cloneId = files.find((f) => f.is_clone)!.file_id;
      useStore.getState().removeFile(cloneId);
      expect(fetchSpy).not.toHaveBeenCalledWith(
        '/api/files/orig-1',
        expect.objectContaining({ method: 'DELETE' })
      );
      expect(fetchSpy).toHaveBeenCalledWith(
        `/api/autosave/process_config_object_${cloneId}`,
        expect.objectContaining({ method: 'DELETE' })
      );
      expect(useStore.getState().uploadedFiles).toHaveLength(1);

      // Removing the last remaining instance SHOULD trigger a backend delete.
      useStore.getState().removeFile('orig-1');
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/files/orig-1',
        expect.objectContaining({ method: 'DELETE' })
      );
      expect(useStore.getState().uploadedFiles).toHaveLength(0);
    });
  });

  describe('ContextMenuSlice', () => {
    it('defaults to closed', () => {
      const state = useStore.getState();
      expect(state.contextMenu.isOpen).toBe(false);
      expect(state.contextMenu.targetFileId).toBeNull();
    });

    it('opens with the given target and position', () => {
      useStore.getState().openContextMenu('file-1', { x: 100, y: 200 });
      const menu = useStore.getState().contextMenu;
      expect(menu.isOpen).toBe(true);
      expect(menu.targetFileId).toBe('file-1');
      expect(menu.position).toEqual({ x: 100, y: 200 });
    });

    it('closes and clears the target', () => {
      useStore.getState().openContextMenu('file-1', { x: 10, y: 10 });
      useStore.getState().closeContextMenu();
      const menu = useStore.getState().contextMenu;
      expect(menu.isOpen).toBe(false);
      expect(menu.targetFileId).toBeNull();
    });
  });

  describe('ArrangeSettingsSlice', () => {
    it('should default to native OrcaSlicer defaults (spacing 0, rotation off, multi-material on, align-Y off)', () => {
      const state = useStore.getState();
      expect(state.arrangeSettings).toEqual({
        spacing: 0,
        enableRotation: false,
        allowMultiMaterialsOnSamePlate: true,
        alignToYAxis: false,
      });
      expect(state.isArrangeSettingsOpen).toBe(false);
    });

    it('should update individual settings', () => {
      useStore.getState().setArrangeSetting('spacing', 5);
      expect(useStore.getState().arrangeSettings.spacing).toBe(5);

      useStore.getState().setArrangeSetting('allowMultiMaterialsOnSamePlate', false);
      expect(useStore.getState().arrangeSettings.allowMultiMaterialsOnSamePlate).toBe(false);
    });

    it('should force alignToYAxis off when enableRotation is turned on (mutually exclusive, matching native)', () => {
      useStore.getState().setArrangeSetting('alignToYAxis', true);
      expect(useStore.getState().arrangeSettings.alignToYAxis).toBe(true);

      useStore.getState().setArrangeSetting('enableRotation', true);
      expect(useStore.getState().arrangeSettings.enableRotation).toBe(true);
      expect(useStore.getState().arrangeSettings.alignToYAxis).toBe(false);
    });

    it('should reset settings to defaults', () => {
      useStore.getState().setArrangeSetting('spacing', 10);
      useStore.getState().setArrangeSetting('enableRotation', true);

      useStore.getState().resetArrangeSettings();

      expect(useStore.getState().arrangeSettings).toEqual({
        spacing: 0,
        enableRotation: false,
        allowMultiMaterialsOnSamePlate: true,
        alignToYAxis: false,
      });
    });

    it('should toggle the settings popup open state', () => {
      useStore.getState().setArrangeSettingsOpen(true);
      expect(useStore.getState().isArrangeSettingsOpen).toBe(true);

      useStore.getState().setArrangeSettingsOpen(false);
      expect(useStore.getState().isArrangeSettingsOpen).toBe(false);
    });

    it('should increment arrangeRequestId each time triggerArrange is called', () => {
      const before = useStore.getState().arrangeRequestId;
      useStore.getState().triggerArrange();
      expect(useStore.getState().arrangeRequestId).toBe(before + 1);

      useStore.getState().triggerArrange();
      expect(useStore.getState().arrangeRequestId).toBe(before + 2);
    });
  });
});
