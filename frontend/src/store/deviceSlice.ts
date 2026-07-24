import { StateCreator } from 'zustand';
import { apiClient } from '../api/client';
import type { DeviceConnection, HostType, PrinterAgent, UploadJobResult } from '../api/client';

export type { DeviceConnection, HostType, PrinterAgent, UploadJobResult };

const DEFAULT_CONNECTION: DeviceConnection = {
  host_type: 'octo_klipper',
  printer_agent: 'moonraker',
  print_host: '',
  device_ui: '',
  printhost_apikey: '',
  printhost_cafile: '',
  connected: false,
};

export interface DeviceSlice {
  /** Persisted printer connection settings for the Device tab (Requirements:
   * "device page should allow connection to local printers" — mirrors
   * native OrcaSlicer's Physical Printer "Print Host upload" dialog:
   * host_type=Octo/Klipper, printer_agent=Moonraker, print_host,
   * device_ui aka native's print_host_webui, printhost_apikey,
   * printhost_cafile). */
  deviceConnection: DeviceConnection;
  /** Whether the connection-config dialog (matching the reference
   * screenshot) is currently open. */
  isDeviceConfigOpen: boolean;
  /** True while a test/save/load request to the backend is in flight. */
  isTestingConnection: boolean;
  /** Result of the most recent connection test, or null if none run yet
   * this session. */
  connectionTestResult: { success: boolean; message: string } | null;

  setDeviceConfigOpen: (open: boolean) => void;
  updateDeviceConnectionField: <K extends keyof DeviceConnection>(
    key: K,
    value: DeviceConnection[K]
  ) => void;
  loadDeviceConnection: () => Promise<void>;
  /** Tests connectivity to the currently-entered (not-yet-saved) settings
   * WITHOUT saving or closing the dialog — matching native's dialog,
   * where "Test" only validates in place and reports success/failure via
   * its own popup (PhysicalPrinterDialog.cpp's `print_host_test` shows a
   * `show_info`/`show_error` message box, entirely separate from the
   * dialog's own OK/Cancel). The result is surfaced via
   * `connectionTestResult` for the caller to render as a popup. */
  testConnection: () => Promise<void>;
  /** Dismisses the test-result popup without affecting anything else
   * (the connection dialog underneath stays open with fields untouched). */
  clearConnectionTestResult: () => void;
  /** Saves the currently-entered settings and marks the connection active
   * (connected=true) — this is the dialog's "OK" action. Does not by
   * itself require a prior successful Test (matching native: OK commits
   * whatever is in the fields; Test is an optional, separate
   * validation), so device_ui's print_host fallback is applied here too
   * rather than only after a test. */
  saveAndConnect: () => Promise<void>;
  disconnectDevice: () => Promise<void>;

  /** Whether the "Send G-code to printer host" dialog (matching native's
   * PrintHostSendDialog — the reference screenshot for this feature) is
   * currently open. Opened by the TopBar's Print button once a slice job
   * has completed. */
  isPrintDialogOpen: boolean;
  setPrintDialogOpen: (open: boolean) => void;
  /** True while an upload/upload-and-print request is in flight. */
  isUploadingToPrinter: boolean;
  /** Result of the most recent upload attempt, or null if none run yet
   * this dialog session. Cleared whenever the dialog is (re)opened. */
  uploadResult: UploadJobResult | null;
  /** Uploads the given completed slice job's gcode to the connected
   * printer host, optionally starting the print immediately (native's
   * "Upload" vs "Upload and Print" buttons). Does not itself close the
   * dialog — the caller decides whether to close on success (matching
   * native, which closes the dialog immediately on confirm and reports
   * upload failures via a separate error dialog after the fact; this
   * app instead keeps the dialog open and shows the result inline so a
   * failed upload can be retried without re-opening from scratch). */
  uploadJobToPrinter: (jobId: string, filename: string, startPrint: boolean) => Promise<void>;
  clearUploadResult: () => void;
}

export const createDeviceSlice: StateCreator<DeviceSlice> = (set, get) => ({
  deviceConnection: DEFAULT_CONNECTION,
  isDeviceConfigOpen: false,
  isTestingConnection: false,
  connectionTestResult: null,

  setDeviceConfigOpen: (open) => {
    set({ isDeviceConfigOpen: open, connectionTestResult: null });
  },

  updateDeviceConnectionField: (key, value) => {
    set((state) => ({
      deviceConnection: { ...state.deviceConnection, [key]: value },
    }));
  },

  loadDeviceConnection: async () => {
    try {
      const connection = await apiClient.getDeviceConnection();
      set({ deviceConnection: connection });
    } catch (error) {
      // No saved connection yet (fresh session) or a transient fetch
      // failure — either way, fall back to the blank/disconnected
      // default rather than surfacing an error on every page load.
      console.error('[DeviceSlice] Failed to load device connection:', error);
    }
  },

  testConnection: async () => {
    const { deviceConnection } = get();
    set({ isTestingConnection: true, connectionTestResult: null });
    try {
      const result = await apiClient.testDeviceConnection(deviceConnection);
      set({ connectionTestResult: { success: result.success, message: result.message } });
    } catch (error) {
      console.error('[DeviceSlice] Connection test failed:', error);
      set({
        connectionTestResult: {
          success: false,
          message: error instanceof Error ? error.message : 'Connection test failed.',
        },
      });
    } finally {
      set({ isTestingConnection: false });
    }
  },

  clearConnectionTestResult: () => {
    set({ connectionTestResult: null });
  },

  saveAndConnect: async () => {
    const { deviceConnection } = get();
    const connected: DeviceConnection = { ...deviceConnection, connected: true };
    // device_ui falls back to print_host if left blank, matching
    // native's PrintHost::get_print_host_webui() fallback — done here
    // (rather than only at render time) so the persisted/saved value is
    // self-contained and the iframe src doesn't depend on a separate
    // runtime fallback computation.
    if (!connected.device_ui.trim()) {
      connected.device_ui = connected.print_host;
    }
    await apiClient.saveDeviceConnection(connected);
    set({ deviceConnection: connected, isDeviceConfigOpen: false, connectionTestResult: null });
  },

  disconnectDevice: async () => {
    try {
      await apiClient.deleteDeviceConnection();
    } catch (error) {
      console.error('[DeviceSlice] Failed to delete device connection:', error);
    }
    set({ deviceConnection: DEFAULT_CONNECTION, connectionTestResult: null });
  },

  isPrintDialogOpen: false,
  setPrintDialogOpen: (open) => {
    set({ isPrintDialogOpen: open, uploadResult: null });
  },

  isUploadingToPrinter: false,
  uploadResult: null,

  uploadJobToPrinter: async (jobId, filename, startPrint) => {
    set({ isUploadingToPrinter: true, uploadResult: null });
    try {
      const result = await apiClient.uploadJobToPrinter({
        job_id: jobId,
        filename,
        start_print: startPrint,
      });
      set({ uploadResult: result });
    } catch (error) {
      console.error('[DeviceSlice] Upload to printer failed:', error);
      set({
        uploadResult: {
          success: false,
          message: error instanceof Error ? error.message : 'Upload failed.',
          print_started: false,
        },
      });
    } finally {
      set({ isUploadingToPrinter: false });
    }
  },

  clearUploadResult: () => {
    set({ uploadResult: null });
  },
});
