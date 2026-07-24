/**
 * PrintDialog ("Send G-code to printer host")
 *
 * Matches native OrcaSlicer's PrintHostSendDialog
 * (slic3r/GUI/PrintHostDialogs.cpp) — see the reference screenshot: an
 * editable filename field (defaulted to the sliced gcode's own
 * filename), a "Switch to Device tab after upload" checkbox, and
 * Upload / Upload and Print / Cancel buttons. Opened by TopBar's Print
 * button once a slice job has completed (see jobSlice's findGcodeOutput
 * for how "has a plate been sliced" is determined).
 *
 * Native's "Switch to Device tab" checkbox (PrintHost.cpp calling
 * `mainframe->request_select_tab(tpMonitor)` post-upload) is replicated
 * here via `setActiveTab('device')` after a successful upload.
 */

import React, { useEffect, useState } from 'react';
import { Upload, X } from 'lucide-react';
import { useStore } from '../../store';

interface PrintDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** The completed slice job to upload — its plate_N.gcode filename is
   * used as the dialog's default upload filename. */
  jobId: string | null;
  defaultFilename: string;
}

export const PrintDialog: React.FC<PrintDialogProps> = ({
  isOpen,
  onClose,
  jobId,
  defaultFilename,
}) => {
  const [filename, setFilename] = useState(defaultFilename);
  const [switchToDeviceTab, setSwitchToDeviceTab] = useState(false);

  const uploadJobToPrinter = useStore((state) => state.uploadJobToPrinter);
  const isUploadingToPrinter = useStore((state) => state.isUploadingToPrinter);
  const uploadResult = useStore((state) => state.uploadResult);
  const clearUploadResult = useStore((state) => state.clearUploadResult);
  const setActiveTab = useStore((state) => state.setActiveTab);
  const deviceConnection = useStore((state) => state.deviceConnection);
  const loadDeviceConnection = useStore((state) => state.loadDeviceConnection);

  // Reset the filename/checkbox to defaults each time the dialog is
  // (re)opened for a (possibly different) job, rather than carrying over
  // stale state from a previous upload. Also (re)loads the persisted
  // device connection — the Device tab is the only other place that
  // fetches it, so a user who prints without ever visiting the Device
  // tab this session would otherwise see a blank "Uploading to" line
  // here despite actually being connected (the backend's own upload
  // endpoint loads its connection independently from disk, so the
  // upload itself still worked — only this display was stale/wrong).
  useEffect(() => {
    if (isOpen) {
      setFilename(defaultFilename);
      setSwitchToDeviceTab(false);
      clearUploadResult();
      loadDeviceConnection();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, defaultFilename]);

  if (!isOpen) return null;

  const handleUpload = async (startPrint: boolean) => {
    if (!jobId || !filename.trim()) return;
    await uploadJobToPrinter(jobId, filename.trim(), startPrint);
    // Only switch tabs / auto-close on an actual success — a failed
    // upload should leave the dialog open with its error visible so the
    // user can fix the host/filename and retry, matching this app's
    // "keep the dialog open, show the result inline" convention (see
    // deviceSlice.ts's uploadJobToPrinter doc comment).
    const result = useStore.getState().uploadResult;
    if (result?.success) {
      if (switchToDeviceTab) {
        setActiveTab('device');
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg shadow-xl w-[480px] border border-gray-700">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700">
          <h2 className="text-sm font-semibold text-gray-100">Send G-code to printer host</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded bg-gray-900 flex items-center justify-center flex-shrink-0">
              <Upload className="w-6 h-6 text-teal-400" />
            </div>
            <div className="flex-1 min-w-0">
              <input
                type="text"
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
                aria-label="Filename"
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              <p className="text-xs text-gray-500 mt-1">
                Use forward slashes (/) as a directory separator if needed.
              </p>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              checked={switchToDeviceTab}
              onChange={(e) => setSwitchToDeviceTab(e.target.checked)}
              className="rounded border-gray-600 bg-gray-700 text-purple-600 focus:ring-purple-500"
            />
            Switch to Device tab after upload.
          </label>

          <p className="text-xs text-gray-500">
            Uploading to{' '}
            <span className="text-gray-300">
              {deviceConnection.device_ui || deviceConnection.print_host}
            </span>
          </p>

          {uploadResult && (
            <div
              className={`text-sm rounded px-3 py-2 ${
                uploadResult.success
                  ? 'bg-green-900/40 text-green-300 border border-green-700'
                  : 'bg-red-900/40 text-red-300 border border-red-700'
              }`}
              role="status"
            >
              {uploadResult.message}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-700">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm text-gray-300 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => handleUpload(false)}
            disabled={isUploadingToPrinter || !filename.trim()}
            className="px-4 py-1.5 text-sm font-medium bg-teal-600 text-white rounded hover:bg-teal-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isUploadingToPrinter ? 'Uploading…' : 'Upload'}
          </button>
          <button
            onClick={() => handleUpload(true)}
            disabled={isUploadingToPrinter || !filename.trim()}
            className="px-4 py-1.5 text-sm font-medium bg-teal-600 text-white rounded hover:bg-teal-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isUploadingToPrinter ? 'Uploading…' : 'Upload and Print'}
          </button>
        </div>
      </div>
    </div>
  );
};
