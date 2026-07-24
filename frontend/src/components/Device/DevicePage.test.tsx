import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DevicePage } from './DevicePage';
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

describe('DevicePage', () => {
  const mockUseStore = useStore as unknown as ReturnType<typeof vi.fn>;
  const mockSetDeviceConfigOpen = vi.fn();
  const mockLoadDeviceConnection = vi.fn();
  const mockDisconnectDevice = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const withState = (state: Record<string, unknown>) => {
    const fullState = {
      deviceConnection: DEFAULT_CONNECTION,
      isDeviceConfigOpen: false,
      isTestingConnection: false,
      connectionTestResult: null,
      setDeviceConfigOpen: mockSetDeviceConfigOpen,
      loadDeviceConnection: mockLoadDeviceConnection,
      disconnectDevice: mockDisconnectDevice,
      updateDeviceConnectionField: vi.fn(),
      testConnection: vi.fn(),
      saveAndConnect: vi.fn(),
      clearConnectionTestResult: vi.fn(),
      ...state,
    };
    mockUseStore.mockImplementation((selector: (s: typeof fullState) => unknown) =>
      selector(fullState)
    );
  };

  it('shows a blank page with a single Connect button when no printer is connected (Requirement 2)', () => {
    withState({});
    render(<DevicePage />);

    expect(screen.getByRole('button', { name: /connect to printer/i })).toBeInTheDocument();
    // No iframe / connection status bar should be present.
    expect(screen.queryByTitle('Printer device UI')).not.toBeInTheDocument();
  });

  it('clicking the Connect button opens the connection config dialog (Requirement 3)', () => {
    withState({});
    render(<DevicePage />);

    screen.getByRole('button', { name: /connect to printer/i }).click();
    expect(mockSetDeviceConfigOpen).toHaveBeenCalledWith(true);
  });

  it('renders the printer device UI in an iframe once connected (Requirement 5)', () => {
    withState({
      deviceConnection: {
        ...DEFAULT_CONNECTION,
        print_host: '192.168.1.50',
        device_ui: 'http://192.168.1.50:7125',
        connected: true,
      },
    });
    render(<DevicePage />);

    const iframe = screen.getByTitle('Printer device UI') as HTMLIFrameElement;
    expect(iframe).toBeInTheDocument();
    expect(iframe.src).toBe('http://192.168.1.50:7125/');
    expect(screen.getByText(/connected to 192.168.1.50/i)).toBeInTheDocument();
  });

  it('falls back to print_host as the iframe URL when device_ui is blank', () => {
    withState({
      deviceConnection: {
        ...DEFAULT_CONNECTION,
        print_host: 'http://192.168.1.50',
        device_ui: '',
        connected: true,
      },
    });
    render(<DevicePage />);

    const iframe = screen.getByTitle('Printer device UI') as HTMLIFrameElement;
    expect(iframe.src).toBe('http://192.168.1.50/');
  });

  it('normalizes a bare host:port (no scheme) to http:// for the iframe src, rather than letting the browser treat it as a relative URL', () => {
    // Regression test: an unprefixed value like "127.0.0.1:7125" used
    // directly as <iframe src> is interpreted as a RELATIVE URL by the
    // browser, which — combined with sandbox="allow-same-origin" —
    // actually navigates the top-level app instead of loading the
    // iframe's own origin, crashing the whole page (confirmed via a real
    // browser: "No routes matched location" + a React Router error
    // boundary). See DevicePage.tsx's deviceUiUrl normalization.
    withState({
      deviceConnection: {
        ...DEFAULT_CONNECTION,
        print_host: '127.0.0.1:7125',
        device_ui: '',
        connected: true,
      },
    });
    render(<DevicePage />);

    const iframe = screen.getByTitle('Printer device UI') as HTMLIFrameElement;
    expect(iframe.src).toBe('http://127.0.0.1:7125/');
  });

  it('clicking Disconnect calls disconnectDevice', () => {
    withState({
      deviceConnection: {
        ...DEFAULT_CONNECTION,
        print_host: '192.168.1.50',
        connected: true,
      },
    });
    render(<DevicePage />);

    screen.getByRole('button', { name: /disconnect/i }).click();
    expect(mockDisconnectDevice).toHaveBeenCalled();
  });

  it('shows an Edit button once connected, which reopens the config dialog with the current settings (Requirement 3)', () => {
    withState({
      deviceConnection: {
        ...DEFAULT_CONNECTION,
        print_host: '192.168.1.50',
        connected: true,
      },
    });
    render(<DevicePage />);

    const editButton = screen.getByRole('button', { name: /edit/i });
    expect(editButton).toBeInTheDocument();
    editButton.click();
    expect(mockSetDeviceConfigOpen).toHaveBeenCalledWith(true);
  });

  it('loads any previously-saved connection on mount', () => {
    withState({});
    render(<DevicePage />);
    expect(mockLoadDeviceConnection).toHaveBeenCalled();
  });
});
