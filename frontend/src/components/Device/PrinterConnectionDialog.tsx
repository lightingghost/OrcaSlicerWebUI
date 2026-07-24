/**
 * PrinterConnectionDialog
 *
 * Matches native OrcaSlicer's Physical Printer "Print Host upload"
 * dialog (slic3r/GUI/PhysicalPrinterDialog.cpp): Host Type, Printer
 * Agent, Hostname/IP/URL (+ Test button), Device UI, API Key / Password,
 * HTTPS CA File. This webapp only implements Host Type = "Octo/Klipper"
 * and Printer Agent = "Moonraker" (the two dropdowns are locked to a
 * single option each rather than hidden, so the field layout still
 * reads the same as native's dialog per the reference screenshot).
 *
 * "Browse" (mDNS/Bonjour discovery in native) has no web equivalent —
 * browsers cannot perform LAN service discovery — so it's omitted rather
 * than implemented as a non-functional button.
 */

import React from 'react';
import { X } from 'lucide-react';
import { useStore } from '../../store';

interface PrinterConnectionDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PrinterConnectionDialog: React.FC<PrinterConnectionDialogProps> = ({
  isOpen,
  onClose,
}) => {
  const deviceConnection = useStore((state) => state.deviceConnection);
  const updateDeviceConnectionField = useStore((state) => state.updateDeviceConnectionField);
  const testConnection = useStore((state) => state.testConnection);
  const saveAndConnect = useStore((state) => state.saveAndConnect);
  const isTestingConnection = useStore((state) => state.isTestingConnection);
  const connectionTestResult = useStore((state) => state.connectionTestResult);
  const clearConnectionTestResult = useStore((state) => state.clearConnectionTestResult);

  if (!isOpen) return null;

  const handleTest = () => {
    // Only validates connectivity — does NOT save or close this dialog,
    // matching native's Test button (PhysicalPrinterDialog.cpp's
    // print_host_test shows its own result message box, entirely
    // separate from the dialog's own OK/Cancel).
    testConnection();
  };

  const handleOk = async () => {
    await saveAndConnect();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg shadow-xl w-[520px] border border-gray-700">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700">
          <h2 className="text-sm font-semibold text-gray-100">Print Host upload</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Host Type — locked to "Octo/Klipper", the only value this
              webapp implements, but still rendered as a select (with a
              single option) so the layout matches native's dialog. */}
          <div className="grid grid-cols-[140px_1fr] items-center gap-3">
            <label htmlFor="host-type" className="text-sm text-gray-300">
              Host Type:
            </label>
            <select
              id="host-type"
              value={deviceConnection.host_type}
              disabled
              className="bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-200 disabled:opacity-70"
            >
              <option value="octo_klipper">Octo/Klipper</option>
            </select>
          </div>

          <div className="grid grid-cols-[140px_1fr] items-center gap-3">
            <label htmlFor="printer-agent" className="text-sm text-gray-300">
              Printer Agent:
            </label>
            <select
              id="printer-agent"
              value={deviceConnection.printer_agent}
              disabled
              className="bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-200 disabled:opacity-70"
            >
              <option value="moonraker">Moonraker</option>
            </select>
          </div>

          <div className="grid grid-cols-[140px_1fr] items-center gap-3">
            <label htmlFor="print-host" className="text-sm text-gray-300">
              Hostname, IP or URL:
            </label>
            <div className="flex gap-2">
              <input
                id="print-host"
                type="text"
                value={deviceConnection.print_host}
                onChange={(e) => updateDeviceConnectionField('print_host', e.target.value)}
                placeholder="192.168.1.50 or http://printer.local"
                className="flex-1 bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              <button
                onClick={handleTest}
                disabled={isTestingConnection || !deviceConnection.print_host.trim()}
                className="px-3 py-1.5 text-sm bg-gray-600 text-gray-200 rounded hover:bg-gray-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isTestingConnection ? 'Testing…' : 'Test'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-[140px_1fr] items-center gap-3">
            <label htmlFor="device-ui" className="text-sm text-gray-300">
              Device UI:
            </label>
            <input
              id="device-ui"
              type="text"
              value={deviceConnection.device_ui}
              onChange={(e) => updateDeviceConnectionField('device_ui', e.target.value)}
              placeholder="Defaults to the URL above if left blank"
              className="bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>

          <div className="grid grid-cols-[140px_1fr] items-center gap-3">
            <label htmlFor="printhost-apikey" className="text-sm text-gray-300">
              API Key / Password:
            </label>
            <input
              id="printhost-apikey"
              type="password"
              value={deviceConnection.printhost_apikey}
              onChange={(e) => updateDeviceConnectionField('printhost_apikey', e.target.value)}
              className="bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>

          <div className="grid grid-cols-[140px_1fr] items-center gap-3">
            <label htmlFor="printhost-cafile" className="text-sm text-gray-300">
              HTTPS CA File:
            </label>
            <input
              id="printhost-cafile"
              type="text"
              value={deviceConnection.printhost_cafile}
              onChange={(e) => updateDeviceConnectionField('printhost_cafile', e.target.value)}
              placeholder="Path to a .crt/.pem file (optional)"
              className="bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>

          <p className="text-xs text-gray-500 pt-1">
            HTTPS CA file is optional. It is only needed if you use HTTPS with a self-signed
            certificate.
          </p>
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-700">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm text-gray-300 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleOk}
            disabled={isTestingConnection || !deviceConnection.print_host.trim()}
            className="px-5 py-1.5 text-sm font-medium bg-teal-600 text-white rounded hover:bg-teal-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            OK
          </button>
        </div>
      </div>

      {/* Test result popup — a separate dialog stacked on top, matching
          native's Test button opening its own message box rather than
          affecting this dialog's own OK/Cancel state. Dismissing it just
          clears the result and returns focus to this dialog (still open,
          fields untouched) — Test never saves or navigates away. */}
      {connectionTestResult && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-[60]">
          <div className="bg-gray-800 rounded-lg shadow-xl w-[380px] border border-gray-700">
            <div className="px-5 py-4">
              <h3
                className={`text-sm font-semibold mb-2 ${
                  connectionTestResult.success ? 'text-green-400' : 'text-red-400'
                }`}
              >
                {connectionTestResult.success ? 'Success!' : 'Connection failed'}
              </h3>
              <p className="text-sm text-gray-300" role="status">
                {connectionTestResult.message}
              </p>
            </div>
            <div className="flex justify-end px-5 py-3 border-t border-gray-700">
              <button
                onClick={clearConnectionTestResult}
                className="px-4 py-1.5 text-sm font-medium bg-gray-600 text-white rounded hover:bg-gray-500 transition-colors"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
