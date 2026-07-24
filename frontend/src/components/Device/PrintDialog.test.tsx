import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PrintDialog } from './PrintDialog';
import { useStore } from '../../store';

vi.mock('../../store', () => ({
  useStore: vi.fn(),
}));

const DEFAULT_CONNECTION = {
  host_type: 'octo_klipper' as const,
  printer_agent: 'moonraker' as const,
  print_host: '192.168.1.50',
  device_ui: 'http://192.168.1.50:7125',
  printhost_apikey: '',
  printhost_cafile: '',
  connected: true,
};

describe('PrintDialog', () => {
  const mockUseStore = useStore as unknown as ReturnType<typeof vi.fn> & {
    getState: ReturnType<typeof vi.fn>;
  };
  const mockUploadJobToPrinter = vi.fn();
  const mockClearUploadResult = vi.fn();
  const mockSetActiveTab = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUploadJobToPrinter.mockResolvedValue(undefined);
  });

  const mockLoadDeviceConnection = vi.fn();

  const withState = (state: Record<string, unknown>) => {
    const fullState = {
      deviceConnection: DEFAULT_CONNECTION,
      uploadJobToPrinter: mockUploadJobToPrinter,
      isUploadingToPrinter: false,
      uploadResult: null,
      clearUploadResult: mockClearUploadResult,
      setActiveTab: mockSetActiveTab,
      loadDeviceConnection: mockLoadDeviceConnection,
      ...state,
    };
    mockUseStore.mockImplementation((selector: (s: typeof fullState) => unknown) =>
      selector(fullState)
    );
    // PrintDialog reads useStore.getState().uploadResult directly after
    // an upload to decide whether to switch tabs (rather than relying on
    // a possibly-stale closure value from the hook render) — mock that
    // static accessor to return the same state object.
    mockUseStore.getState = vi.fn(() => fullState);
  };

  it('renders nothing when isOpen is false', () => {
    withState({});
    const { container } = render(
      <PrintDialog isOpen={false} onClose={vi.fn()} jobId="job-1" defaultFilename="plate_1.gcode" />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('reloads the device connection when opened, so a stale/never-fetched deviceConnection does not show a blank "Uploading to" line (regression: printing without ever visiting the Device tab)', () => {
    withState({});
    render(
      <PrintDialog isOpen={true} onClose={vi.fn()} jobId="job-1" defaultFilename="plate_1.gcode" />
    );
    expect(mockLoadDeviceConnection).toHaveBeenCalled();
  });

  it('shows the reference dialog fields: filename input, switch-to-device-tab checkbox, Upload/Upload and Print/Cancel', () => {
    withState({});
    render(
      <PrintDialog isOpen={true} onClose={vi.fn()} jobId="job-1" defaultFilename="plate_1.gcode" />
    );

    expect(screen.getByLabelText(/filename/i)).toHaveValue('plate_1.gcode');
    expect(screen.getByText(/switch to device tab after upload/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^upload$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /upload and print/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeInTheDocument();
  });

  it('defaults the filename to the sliced gcode filename passed in', () => {
    withState({});
    render(
      <PrintDialog isOpen={true} onClose={vi.fn()} jobId="job-1" defaultFilename="box.gcode" />
    );
    expect(screen.getByLabelText(/filename/i)).toHaveValue('box.gcode');
  });

  it('clicking Upload calls uploadJobToPrinter with start_print=false', async () => {
    withState({});
    render(
      <PrintDialog isOpen={true} onClose={vi.fn()} jobId="job-1" defaultFilename="plate_1.gcode" />
    );

    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }));

    await waitFor(() => {
      expect(mockUploadJobToPrinter).toHaveBeenCalledWith('job-1', 'plate_1.gcode', false);
    });
  });

  it('clicking Upload and Print calls uploadJobToPrinter with start_print=true', async () => {
    withState({});
    render(
      <PrintDialog isOpen={true} onClose={vi.fn()} jobId="job-1" defaultFilename="plate_1.gcode" />
    );

    fireEvent.click(screen.getByRole('button', { name: /upload and print/i }));

    await waitFor(() => {
      expect(mockUploadJobToPrinter).toHaveBeenCalledWith('job-1', 'plate_1.gcode', true);
    });
  });

  it('uses the edited filename rather than the default when the user changes it', async () => {
    withState({});
    render(
      <PrintDialog isOpen={true} onClose={vi.fn()} jobId="job-1" defaultFilename="plate_1.gcode" />
    );

    fireEvent.change(screen.getByLabelText(/filename/i), { target: { value: 'my_print.gcode' } });
    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }));

    await waitFor(() => {
      expect(mockUploadJobToPrinter).toHaveBeenCalledWith('job-1', 'my_print.gcode', false);
    });
  });

  it('shows a success message after a successful upload', () => {
    withState({
      uploadResult: { success: true, message: 'Upload complete.', print_started: false },
    });
    render(
      <PrintDialog isOpen={true} onClose={vi.fn()} jobId="job-1" defaultFilename="plate_1.gcode" />
    );
    expect(screen.getByRole('status')).toHaveTextContent(/upload complete/i);
  });

  it('shows a failure message and keeps the dialog open after a failed upload', () => {
    const onClose = vi.fn();
    withState({
      uploadResult: { success: false, message: 'Could not connect to printer', print_started: false },
    });
    render(
      <PrintDialog isOpen={true} onClose={onClose} jobId="job-1" defaultFilename="plate_1.gcode" />
    );
    expect(screen.getByRole('status')).toHaveTextContent(/could not connect/i);
    // Dialog fields must still be present/editable for a retry.
    expect(screen.getByLabelText(/filename/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('switches to the Device tab after a successful upload when the checkbox is checked', async () => {
    withState({});
    // Simulate the upload succeeding by having getState reflect the
    // post-upload state once uploadJobToPrinter resolves.
    mockUploadJobToPrinter.mockImplementation(async () => {
      mockUseStore.getState = vi.fn(() => ({
        uploadResult: { success: true, message: 'ok', print_started: false },
      }));
    });

    render(
      <PrintDialog isOpen={true} onClose={vi.fn()} jobId="job-1" defaultFilename="plate_1.gcode" />
    );

    fireEvent.click(screen.getByLabelText(/switch to device tab/i));
    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }));

    await waitFor(() => {
      expect(mockSetActiveTab).toHaveBeenCalledWith('device');
    });
  });

  it('does NOT switch tabs after a failed upload even if the checkbox is checked', async () => {
    withState({});
    mockUploadJobToPrinter.mockImplementation(async () => {
      mockUseStore.getState = vi.fn(() => ({
        uploadResult: { success: false, message: 'failed', print_started: false },
      }));
    });

    render(
      <PrintDialog isOpen={true} onClose={vi.fn()} jobId="job-1" defaultFilename="plate_1.gcode" />
    );

    fireEvent.click(screen.getByLabelText(/switch to device tab/i));
    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }));

    await waitFor(() => {
      expect(mockUploadJobToPrinter).toHaveBeenCalled();
    });
    expect(mockSetActiveTab).not.toHaveBeenCalled();
  });

  it('does not switch tabs after a successful upload when the checkbox is unchecked', async () => {
    withState({});
    mockUploadJobToPrinter.mockImplementation(async () => {
      mockUseStore.getState = vi.fn(() => ({
        uploadResult: { success: true, message: 'ok', print_started: false },
      }));
    });

    render(
      <PrintDialog isOpen={true} onClose={vi.fn()} jobId="job-1" defaultFilename="plate_1.gcode" />
    );

    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }));

    await waitFor(() => {
      expect(mockUploadJobToPrinter).toHaveBeenCalled();
    });
    expect(mockSetActiveTab).not.toHaveBeenCalled();
  });

  it('calls onClose when Cancel is clicked', () => {
    withState({});
    const onClose = vi.fn();
    render(
      <PrintDialog isOpen={true} onClose={onClose} jobId="job-1" defaultFilename="plate_1.gcode" />
    );

    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('Upload buttons are disabled while an upload is in flight', () => {
    withState({ isUploadingToPrinter: true });
    render(
      <PrintDialog isOpen={true} onClose={vi.fn()} jobId="job-1" defaultFilename="plate_1.gcode" />
    );

    const uploadingButtons = screen.getAllByRole('button', { name: /uploading/i });
    expect(uploadingButtons).toHaveLength(2);
    uploadingButtons.forEach((btn) => expect(btn).toBeDisabled());
  });
});
