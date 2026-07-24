import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDeviceSlice, DeviceSlice } from './deviceSlice';
import { apiClient } from '../api/client';

vi.mock('../api/client', () => ({
  apiClient: {
    getDeviceConnection: vi.fn(),
    saveDeviceConnection: vi.fn(),
    deleteDeviceConnection: vi.fn(),
    testDeviceConnection: vi.fn(),
    uploadJobToPrinter: vi.fn(),
  },
}));

function createTestSlice() {
  let state: DeviceSlice;
  const set = (updater: Partial<DeviceSlice> | ((s: DeviceSlice) => Partial<DeviceSlice>)) => {
    const partial = typeof updater === 'function' ? updater(state) : updater;
    state = { ...state, ...partial };
  };
  const get = () => state;
  state = createDeviceSlice(set as any, get as any, undefined as any);
  return { get, set };
}

describe('deviceSlice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defaults to a blank, disconnected connection', () => {
    const { get } = createTestSlice();
    expect(get().deviceConnection.connected).toBe(false);
    expect(get().deviceConnection.print_host).toBe('');
    expect(get().deviceConnection.host_type).toBe('octo_klipper');
    expect(get().deviceConnection.printer_agent).toBe('moonraker');
    expect(get().isDeviceConfigOpen).toBe(false);
  });

  it('setDeviceConfigOpen toggles the config dialog and clears any stale test result', () => {
    const { get, set } = createTestSlice();
    set({ connectionTestResult: { success: true, message: 'stale' } });
    get().setDeviceConfigOpen(true);
    expect(get().isDeviceConfigOpen).toBe(true);
    expect(get().connectionTestResult).toBeNull();
  });

  it('updateDeviceConnectionField updates a single field without clobbering the rest', () => {
    const { get } = createTestSlice();
    get().updateDeviceConnectionField('print_host', '192.168.1.50');
    expect(get().deviceConnection.print_host).toBe('192.168.1.50');
    expect(get().deviceConnection.printer_agent).toBe('moonraker');
  });

  it('loadDeviceConnection populates deviceConnection from the API', async () => {
    const saved = {
      host_type: 'octo_klipper' as const,
      printer_agent: 'moonraker' as const,
      print_host: '192.168.1.50',
      device_ui: 'http://192.168.1.50',
      printhost_apikey: 'abc',
      printhost_cafile: '',
      connected: true,
    };
    vi.mocked(apiClient.getDeviceConnection).mockResolvedValue(saved);

    const { get } = createTestSlice();
    await get().loadDeviceConnection();

    expect(get().deviceConnection).toEqual(saved);
  });

  it('loadDeviceConnection silently keeps defaults on fetch failure', async () => {
    vi.mocked(apiClient.getDeviceConnection).mockRejectedValue(new Error('network error'));

    const { get } = createTestSlice();
    await get().loadDeviceConnection();

    expect(get().deviceConnection.connected).toBe(false);
  });

  it('testConnection never saves or closes the dialog, even on success — matching native, where Test only validates', async () => {
    vi.mocked(apiClient.testDeviceConnection).mockResolvedValue({
      success: true,
      message: 'Connection to Moonraker is working correctly.',
      klippy_state: 'ready',
    });

    const { get } = createTestSlice();
    get().updateDeviceConnectionField('print_host', '192.168.1.50');
    get().setDeviceConfigOpen(true);

    await get().testConnection();

    expect(get().deviceConnection.connected).toBe(false);
    expect(get().isDeviceConfigOpen).toBe(true);
    expect(apiClient.saveDeviceConnection).not.toHaveBeenCalled();
    expect(get().connectionTestResult).toEqual({
      success: true,
      message: 'Connection to Moonraker is working correctly.',
    });
  });

  it('testConnection surfaces a failure result without saving or closing the dialog', async () => {
    vi.mocked(apiClient.testDeviceConnection).mockResolvedValue({
      success: false,
      message: 'Could not connect to 192.168.1.50: connection refused',
    });

    const { get } = createTestSlice();
    get().updateDeviceConnectionField('print_host', '192.168.1.50');
    get().setDeviceConfigOpen(true);

    await get().testConnection();

    expect(get().deviceConnection.connected).toBe(false);
    expect(get().isDeviceConfigOpen).toBe(true);
    expect(apiClient.saveDeviceConnection).not.toHaveBeenCalled();
    expect(get().connectionTestResult?.success).toBe(false);
  });

  it('testConnection surfaces a network-level error as a failed test result', async () => {
    vi.mocked(apiClient.testDeviceConnection).mockRejectedValue(new Error('fetch failed'));

    const { get } = createTestSlice();
    get().updateDeviceConnectionField('print_host', '192.168.1.50');

    await get().testConnection();

    expect(get().connectionTestResult).toEqual({ success: false, message: 'fetch failed' });
    expect(get().isTestingConnection).toBe(false);
  });

  it('clearConnectionTestResult clears the result without touching anything else', () => {
    const { get, set } = createTestSlice();
    get().setDeviceConfigOpen(true);
    set({ connectionTestResult: { success: true, message: 'ok' } });

    get().clearConnectionTestResult();

    expect(get().connectionTestResult).toBeNull();
    expect(get().isDeviceConfigOpen).toBe(true);
  });

  it('saveAndConnect persists the connection with connected=true and closes the dialog (Requirement: OK saves)', async () => {
    vi.mocked(apiClient.saveDeviceConnection).mockImplementation(async (c) => c);

    const { get } = createTestSlice();
    get().updateDeviceConnectionField('print_host', '192.168.1.50');
    get().setDeviceConfigOpen(true);

    await get().saveAndConnect();

    expect(get().deviceConnection.connected).toBe(true);
    expect(get().isDeviceConfigOpen).toBe(false);
    expect(apiClient.saveDeviceConnection).toHaveBeenCalledWith(
      expect.objectContaining({ connected: true, print_host: '192.168.1.50' })
    );
  });

  it('saveAndConnect defaults device_ui to print_host when left blank', async () => {
    vi.mocked(apiClient.saveDeviceConnection).mockImplementation(async (c) => c);

    const { get } = createTestSlice();
    get().updateDeviceConnectionField('print_host', '192.168.1.50');

    await get().saveAndConnect();

    expect(get().deviceConnection.device_ui).toBe('192.168.1.50');
  });

  it('saveAndConnect preserves a manually-set device_ui rather than overwriting it', async () => {
    vi.mocked(apiClient.saveDeviceConnection).mockImplementation(async (c) => c);

    const { get } = createTestSlice();
    get().updateDeviceConnectionField('print_host', '192.168.1.50');
    get().updateDeviceConnectionField('device_ui', 'http://custom-ui.local');

    await get().saveAndConnect();

    expect(get().deviceConnection.device_ui).toBe('http://custom-ui.local');
  });

  it('saveAndConnect does not require a prior successful test (Test and OK are independent, matching native)', async () => {
    vi.mocked(apiClient.saveDeviceConnection).mockImplementation(async (c) => c);

    const { get } = createTestSlice();
    get().updateDeviceConnectionField('print_host', '192.168.1.50');

    await get().saveAndConnect();

    expect(apiClient.testDeviceConnection).not.toHaveBeenCalled();
    expect(get().deviceConnection.connected).toBe(true);
  });

  it('disconnectDevice resets to defaults and clears persisted settings', async () => {
    vi.mocked(apiClient.deleteDeviceConnection).mockResolvedValue({ message: 'ok' });

    const { get } = createTestSlice();
    get().updateDeviceConnectionField('print_host', '192.168.1.50');
    get().updateDeviceConnectionField('connected', true);

    await get().disconnectDevice();

    expect(get().deviceConnection.connected).toBe(false);
    expect(get().deviceConnection.print_host).toBe('');
    expect(apiClient.deleteDeviceConnection).toHaveBeenCalled();
  });
});


describe('deviceSlice — print dialog / upload-to-printer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defaults isPrintDialogOpen to false and uploadResult to null', () => {
    const { get } = createTestSlice();
    expect(get().isPrintDialogOpen).toBe(false);
    expect(get().uploadResult).toBeNull();
  });

  it('setPrintDialogOpen toggles the dialog and clears any stale upload result', () => {
    const { get, set } = createTestSlice();
    set({ uploadResult: { success: true, message: 'stale', print_started: false } });

    get().setPrintDialogOpen(true);

    expect(get().isPrintDialogOpen).toBe(true);
    expect(get().uploadResult).toBeNull();
  });

  it('uploadJobToPrinter calls apiClient with the given job/filename/startPrint and stores the result', async () => {
    vi.mocked(apiClient.uploadJobToPrinter).mockResolvedValue({
      success: true,
      message: 'Upload complete.',
      uploaded_filename: 'plate_1.gcode',
      print_started: false,
    });

    const { get } = createTestSlice();
    await get().uploadJobToPrinter('job-1', 'plate_1.gcode', false);

    expect(apiClient.uploadJobToPrinter).toHaveBeenCalledWith({
      job_id: 'job-1',
      filename: 'plate_1.gcode',
      start_print: false,
    });
    expect(get().uploadResult).toEqual({
      success: true,
      message: 'Upload complete.',
      uploaded_filename: 'plate_1.gcode',
      print_started: false,
    });
    expect(get().isUploadingToPrinter).toBe(false);
  });

  it('uploadJobToPrinter passes start_print=true for Upload and Print', async () => {
    vi.mocked(apiClient.uploadJobToPrinter).mockResolvedValue({
      success: true,
      message: 'Upload complete and print started.',
      uploaded_filename: 'plate_1.gcode',
      print_started: true,
    });

    const { get } = createTestSlice();
    await get().uploadJobToPrinter('job-1', 'plate_1.gcode', true);

    expect(apiClient.uploadJobToPrinter).toHaveBeenCalledWith(
      expect.objectContaining({ start_print: true })
    );
    expect(get().uploadResult?.print_started).toBe(true);
  });

  it('uploadJobToPrinter surfaces a network-level error as a failed result rather than throwing', async () => {
    vi.mocked(apiClient.uploadJobToPrinter).mockRejectedValue(new Error('network down'));

    const { get } = createTestSlice();
    await get().uploadJobToPrinter('job-1', 'plate_1.gcode', false);

    expect(get().uploadResult).toEqual({
      success: false,
      message: 'network down',
      print_started: false,
    });
    expect(get().isUploadingToPrinter).toBe(false);
  });

  it('clearUploadResult clears the result without touching isPrintDialogOpen', () => {
    const { get, set } = createTestSlice();
    get().setPrintDialogOpen(true);
    set({ uploadResult: { success: true, message: 'ok', print_started: false } });

    get().clearUploadResult();

    expect(get().uploadResult).toBeNull();
    expect(get().isPrintDialogOpen).toBe(true);
  });
});
