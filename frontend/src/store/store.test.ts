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
      arrange: 0,
      orient: 0,
      repetitions: 1,
      ensure_on_bed: false,
      assemble: false,
      convert_unit: false,
    };
    state.modelBounds = null;
    state.isOutOfBounds = false;
    state.cameraPreset = 'home';
    
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
      expect(state.uploadedFiles[0]).toEqual(mockFile);
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

      (global.fetch as any).mockResolvedValueOnce({ ok: true });

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
      expect(state.transforms.arrange).toBe(0);
      expect(state.transforms.orient).toBe(0);
      expect(state.transforms.repetitions).toBe(1);
      expect(state.transforms.ensure_on_bed).toBe(false);
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
      // Set various transforms
      useStore.getState().setTransform('rotate', 90);
      useStore.getState().setTransform('scale', 1.5);
      useStore.getState().setTransform('arrange', 2);
      useStore.getState().setTransform('ensure_on_bed', true);

      // Reset
      useStore.getState().resetTransforms();

      const state = useStore.getState();
      expect(state.transforms.rotate).toBe(0);
      expect(state.transforms.scale).toBe(1);
      expect(state.transforms.arrange).toBe(0);
      expect(state.transforms.ensure_on_bed).toBe(false);
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
      expect(state.cameraPreset).toBe('home');
    });

    it('should set camera preset', () => {
      useStore.getState().setCameraPreset('top');
      expect(useStore.getState().cameraPreset).toBe('top');

      useStore.getState().setCameraPreset('front');
      expect(useStore.getState().cameraPreset).toBe('front');

      useStore.getState().setCameraPreset('side');
      expect(useStore.getState().cameraPreset).toBe('side');

      useStore.getState().setCameraPreset('free');
      expect(useStore.getState().cameraPreset).toBe('free');
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
});
