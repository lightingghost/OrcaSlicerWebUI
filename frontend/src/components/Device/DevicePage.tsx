/**
 * DevicePage
 *
 * Content for the "Device" tab (see MainArea.tsx / TopBar.tsx). Lets the
 * user connect to a local printer host (OctoPrint/Klipper via a
 * Moonraker agent) and, once connected, embeds the printer's own web UI
 * (Mainsail/Fluidd/etc — the "Device UI" field) in an iframe, matching
 * native OrcaSlicer's Device tab behavior of showing the physical
 * printer's own interface once a print host is configured
 * (slic3r/GUI/MainFrame.cpp's device tab / PrinterWebViewHandler.cpp).
 *
 * Three states:
 *  - Not connected: blank page with a single "Connect to printer" button.
 *  - Connection dialog open: PrinterConnectionDialog (see that file).
 *  - Connected: the configured device_ui URL embedded full-height.
 */

import React, { useEffect } from 'react';
import { Wifi, WifiOff, Pencil } from 'lucide-react';
import { useStore } from '../../store';
import { PrinterConnectionDialog } from './PrinterConnectionDialog';

export const DevicePage: React.FC = () => {
  const deviceConnection = useStore((state) => state.deviceConnection);
  const isDeviceConfigOpen = useStore((state) => state.isDeviceConfigOpen);
  const setDeviceConfigOpen = useStore((state) => state.setDeviceConfigOpen);
  const loadDeviceConnection = useStore((state) => state.loadDeviceConnection);
  const disconnectDevice = useStore((state) => state.disconnectDevice);

  // Restore a previously-saved connection on first mount, so a
  // successful connection persists across page reloads (matching native,
  // where a configured Physical Printer stays configured until the user
  // removes it).
  useEffect(() => {
    loadDeviceConnection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isConnected = deviceConnection.connected && deviceConnection.print_host.trim() !== '';
  const rawDeviceUiUrl = deviceConnection.device_ui.trim() || deviceConnection.print_host;
  // A bare host/IP (no "http://"/"https://" prefix — e.g. "192.168.1.50"
  // or "192.168.1.50:7125") is a valid value for this field (mirrors
  // native's print_host, which also accepts a bare host), but used
  // directly as an <iframe src> it's interpreted as a RELATIVE url by
  // the browser rather than an absolute one — which, combined with
  // sandbox="allow-same-origin", actually navigates the top-level
  // React Router app to that path instead of loading the iframe's own
  // origin, breaking the whole page (confirmed: "No routes matched
  // location ..." + a crashed router error boundary). Default to plain
  // HTTP, matching Moonraker's own LAN default and the backend's
  // identical normalization in device_connection.py's
  // `_normalize_moonraker_base_url`.
  const deviceUiUrl =
    rawDeviceUiUrl.startsWith('http://') || rawDeviceUiUrl.startsWith('https://')
      ? rawDeviceUiUrl
      : `http://${rawDeviceUiUrl}`;

  return (
    <div className="w-full h-full flex flex-col bg-gray-900">
      {isConnected ? (
        <>
          <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
            <div className="flex items-center gap-2 text-sm text-gray-300">
              <Wifi className="w-4 h-4 text-green-400" />
              Connected to {deviceConnection.print_host}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setDeviceConfigOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1 text-xs text-gray-300 hover:text-white hover:bg-gray-700 rounded transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" />
                Edit
              </button>
              <button
                onClick={disconnectDevice}
                className="flex items-center gap-1.5 px-3 py-1 text-xs text-gray-300 hover:text-white hover:bg-gray-700 rounded transition-colors"
              >
                <WifiOff className="w-3.5 h-3.5" />
                Disconnect
              </button>
            </div>
          </div>

          {/* Embeds the printer's own UI (Mainsail/Fluidd/etc). Whether
              this actually renders depends on the target server's own
              X-Frame-Options/CSP headers allowing iframe embedding — this
              app has no control over that; Mainsail/Fluidd don't set
              restrictive framing headers by default, but a
              misconfigured/hardened Moonraker reverse proxy could still
              block it, in which case the iframe will simply show
              whatever refusal page the browser renders. */}
          <iframe
            key={deviceUiUrl}
            src={deviceUiUrl}
            title="Printer device UI"
            className="flex-1 w-full border-0"
            // No `sandbox` attribute: combining allow-scripts with
            // allow-same-origin (both required for Mainsail/Fluidd to
            // function — they're full single-page apps needing same-origin
            // API/WebSocket access) is a documented sandbox escape that
            // provides no real isolation anyway, so setting it would only
            // create a false impression of restriction. This is the
            // user's own local trusted printer's UI, not third-party
            // content.
          />
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <button
            onClick={() => setDeviceConfigOpen(true)}
            className="flex items-center gap-2 px-6 py-3 text-sm font-semibold bg-purple-600 text-white rounded hover:bg-purple-500 transition-colors shadow-lg shadow-purple-500/30"
          >
            <Wifi className="w-4 h-4" />
            Connect to printer
          </button>
        </div>
      )}

      <PrinterConnectionDialog
        isOpen={isDeviceConfigOpen}
        onClose={() => setDeviceConfigOpen(false)}
      />
    </div>
  );
};
