/**
 * OutputFilesDropdown
 *
 * A compact button + dropdown, docked next to the Export button in
 * TopBar, that lists the most recently completed job's output files
 * (sliced gcode, exported 3mf/stl/settings) with per-file download links.
 *
 * Replaces the old full-width OutputFileList panel that used to sit under
 * the viewport (see MainArea) — that placement pushed the 3D view up
 * every time a job completed and had no native OrcaSlicer equivalent.
 * Docking file access next to Export instead matches native's convention
 * of surfacing sliced-file access near the export/save actions rather
 * than as a persistent panel.
 *
 * Reads directly from jobSlice's `outputFiles` (already populated on job
 * completion via the WebSocket/polling handlers), so no extra fetch is
 * needed here.
 */

import React, { useEffect, useState } from 'react';
import { Download, ChevronDown, FileText } from 'lucide-react';
import { useStore } from '../../store';

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

export const OutputFilesDropdown: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const jobStatus = useStore((state) => state.jobStatus);
  const outputFiles = useStore((state) => state.outputFiles) ?? [];

  const hasFiles = jobStatus === 'completed' && outputFiles.length > 0;
  const thumbnailFile = outputFiles.find((f) => f.filename === 'thumbnail.png') ?? null;

  // Fetch the thumbnail as an authenticated blob (a plain <img src=...>
  // can't attach the Authorization header the download endpoint
  // requires) and turn it into an object URL for display. Revokes the
  // previous object URL whenever the thumbnail changes/unmounts to avoid
  // leaking blob URLs across job completions.
  useEffect(() => {
    if (!thumbnailFile) {
      setThumbnailUrl(null);
      return;
    }
    let objectUrl: string | null = null;
    let cancelled = false;
    fetch(thumbnailFile.download_url, {
      headers: { Authorization: `Bearer ${localStorage.getItem('api_token') || ''}` },
    })
      .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(`${res.status}`))))
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setThumbnailUrl(objectUrl);
      })
      .catch((error) => {
        console.error('[OutputFilesDropdown] Failed to load thumbnail:', error);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [thumbnailFile?.download_url]);

  if (!hasFiles) return null;

  const handleDownload = async (filename: string, downloadUrl: string) => {
    try {
      const response = await fetch(downloadUrl, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('api_token') || ''}`,
        },
      });
      if (!response.ok) throw new Error(`Download failed: ${response.status}`);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to download output file:', error);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen((v) => !v)}
        className="
          flex items-center gap-2 px-3 py-2 text-sm font-medium
          text-gray-300 hover:bg-gray-700 hover:text-white rounded
          transition-colors
        "
        title="Download sliced/exported output files"
        aria-label="Output files"
      >
        <FileText className="w-4 h-4" />
        Output Files
        <span className="text-xs bg-purple-600 text-white rounded-full px-1.5">
          {outputFiles.length}
        </span>
        <ChevronDown className="w-3 h-3" />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-72 bg-gray-700 rounded-md shadow-lg z-50 border border-gray-600">
          {/* Plate thumbnail preview — a snapshot of the Prepare-tab 3D
              view captured right after this job's slice finished (native
              OrcaSlicer's CLI has no way to render a gcode thumbnail
              itself; see routers/jobs.py's POST .../thumbnail doc comment
              for why). Shown above the file list rather than mixed into
              it as just another downloadable row. */}
          {thumbnailFile && (
            <div className="p-2 border-b border-gray-600">
              {thumbnailUrl ? (
                <img
                  src={thumbnailUrl}
                  alt="Sliced plate thumbnail"
                  className="w-full rounded border border-gray-600 bg-gray-900"
                />
              ) : (
                <div className="w-full h-32 rounded border border-gray-600 bg-gray-900 flex items-center justify-center text-xs text-gray-500">
                  Loading thumbnail…
                </div>
              )}
            </div>
          )}

          <div className="py-1 divide-y divide-gray-600">
            {outputFiles
              .filter((file) => file.filename !== 'thumbnail.png')
              .map((file) => (
                <div
                  key={file.filename}
                  className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-gray-600 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-gray-100 truncate" title={file.filename}>
                      {file.filename}
                    </p>
                    <p className="text-xs text-gray-400">{formatFileSize(file.size_bytes)}</p>
                  </div>
                  <button
                    onClick={() => handleDownload(file.filename, file.download_url)}
                    className="flex-shrink-0 p-1.5 text-gray-300 hover:text-white hover:bg-gray-500 rounded transition-colors"
                    aria-label={`Download ${file.filename}`}
                  >
                    <Download className="w-4 h-4" />
                  </button>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
};
