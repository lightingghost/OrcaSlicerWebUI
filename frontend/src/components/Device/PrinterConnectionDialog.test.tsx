import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { PrinterConnectionDialog } from './PrinterConnectionDialog';
import { useStore } from '../../store';

vi.mock('../../store', () => ({
  useStore: vi.fn(),
}));

const DEFAULT_CONNECTION = {
  host_type: 'octo_klipper' as const,
  printer_agent: 'moonraker' as const,
  print_host: '',
  device_ui: '',
  printhost_apikey: '',
  printhost_cafile: '',
  connected: false,
};

describe('PrinterConnectionDialog', () => {
  const mockUseStore = useStore as unknown as ReturnType<typeof vi.fn>;
  const mockUpdateField = vi.fn();
  const mockTestConnection = vi.fn();
  const mockSaveAndConnect = vi.fn();
  const mockClearConnectionTestResult = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const withState = (state: Record<string, unknown>) => {
    const fullState = {
      deviceConnection: DEFAULT_CONNECTION,
      updateDeviceConnectionField: mockUpdateField,
      testConnection: mockTestConnection,
      saveAndConnect: mockSaveAndConnect,
      clearConnectionTestResult: mockClearConnectionTestResult,
      isTestingConnection: false,
      connectionTestResult: null,
      ...state,
    };
    mockUseStore.mockImplementation((selector: (s: typeof fullState) => unknown) =>
      selector(fullState)
    );
  };

  it('renders nothing when isOpen is false', () => {
    withState({});
    const { container } = render(<PrinterConnectionDialog isOpen={false} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows Host Type = Octo/Klipper and Printer Agent = Moonraker (Requirement 4)', () => {
    withState({});
    render(<PrinterConnectionDialog isOpen={true} onClose={vi.fn()} />);

    expect(screen.getByLabelText(/host type/i)).toHaveValue('octo_klipper');
    expect(screen.getByLabelText(/printer agent/i)).toHaveValue('moonraker');
    expect(screen.getByText('Octo/Klipper')).toBeInTheDocument();
    expect(screen.getByText('Moonraker')).toBeInTheDocument();
  });

  it('renders all fields from the reference screenshot', () => {
    withState({});
    render(<PrinterConnectionDialog isOpen={true} onClose={vi.fn()} />);

    expect(screen.getByLabelText(/hostname, ip or url/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/device ui/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/api key \/ password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/https ca file/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^test$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^ok$/i })).toBeInTheDocument();
  });

  it('typing in the Hostname field updates print_host', () => {
    withState({});
    render(<PrinterConnectionDialog isOpen={true} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/hostname, ip or url/i), {
      target: { value: '192.168.1.50' },
    });
    expect(mockUpdateField).toHaveBeenCalledWith('print_host', '192.168.1.50');
  });

  it('Test and OK buttons are disabled until a host is entered', () => {
    withState({ deviceConnection: { ...DEFAULT_CONNECTION, print_host: '' } });
    render(<PrinterConnectionDialog isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: /^test$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^ok$/i })).toBeDisabled();
  });

  it('clicking Test calls testConnection only — never saveAndConnect (Requirement 2: Test must not close/save)', () => {
    withState({ deviceConnection: { ...DEFAULT_CONNECTION, print_host: '192.168.1.50' } });
    render(<PrinterConnectionDialog isOpen={true} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /^test$/i }));
    expect(mockTestConnection).toHaveBeenCalled();
    expect(mockSaveAndConnect).not.toHaveBeenCalled();
  });

  it('clicking OK calls saveAndConnect (Requirement 4: OK persists the connection)', () => {
    withState({ deviceConnection: { ...DEFAULT_CONNECTION, print_host: '192.168.1.50' } });
    render(<PrinterConnectionDialog isOpen={true} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /^ok$/i }));
    expect(mockSaveAndConnect).toHaveBeenCalled();
    expect(mockTestConnection).not.toHaveBeenCalled();
  });

  it('shows a success popup after a successful test, separate from the main dialog (Requirement 2)', () => {
    withState({
      deviceConnection: { ...DEFAULT_CONNECTION, print_host: '192.168.1.50' },
      connectionTestResult: { success: true, message: 'Connection to Moonraker is working correctly.' },
    });
    render(<PrinterConnectionDialog isOpen={true} onClose={vi.fn()} />);

    // The main dialog (Host Type field etc) must still be present — the
    // test result is an overlay popup, not a replacement for the dialog.
    expect(screen.getByLabelText(/host type/i)).toBeInTheDocument();
    expect(screen.getByText(/success!/i)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/working correctly/i);
  });

  it('shows a failure popup after a failed test, without closing the main dialog', () => {
    withState({
      deviceConnection: { ...DEFAULT_CONNECTION, print_host: '192.168.1.50' },
      connectionTestResult: { success: false, message: 'Could not connect to 192.168.1.50' },
    });
    render(<PrinterConnectionDialog isOpen={true} onClose={vi.fn()} />);

    expect(screen.getByLabelText(/host type/i)).toBeInTheDocument();
    expect(screen.getByText(/connection failed/i)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/could not connect/i);
  });

  it('dismissing the test-result popup calls clearConnectionTestResult without closing the dialog', () => {
    const onClose = vi.fn();
    withState({
      deviceConnection: { ...DEFAULT_CONNECTION, print_host: '192.168.1.50' },
      connectionTestResult: { success: true, message: 'ok' },
    });
    render(<PrinterConnectionDialog isOpen={true} onClose={onClose} />);

    // Two "OK" buttons exist now: the popup's dismiss and the dialog's
    // own OK (save). Target the popup's by scoping to its container.
    const popupHeading = screen.getByText(/success!/i);
    const popup = popupHeading.closest('div')?.parentElement as HTMLElement;
    fireEvent.click(within(popup).getByRole('button', { name: /^ok$/i }));

    expect(mockClearConnectionTestResult).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(mockSaveAndConnect).not.toHaveBeenCalled();
  });

  it('calls onClose when the close (X) button is clicked', () => {
    withState({});
    const onClose = vi.fn();
    render(<PrinterConnectionDialog isOpen={true} onClose={onClose} />);

    fireEvent.click(screen.getByLabelText(/close/i));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when Cancel is clicked', () => {
    withState({});
    const onClose = vi.fn();
    render(<PrinterConnectionDialog isOpen={true} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
