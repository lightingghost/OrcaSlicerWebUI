import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, Trash2, Layers } from 'lucide-react';
import { useStore } from '../store';

/**
 * ObjectContextMenu Component
 *
 * Right-click menu for a plate object, matching native OrcaSlicer's
 * object-list right-click menu (src/slic3r/GUI/GUI_ObjectList.cpp):
 *   - "Delete" (labeled "Remove" here) — removes the object from the plate.
 *   - "Clone" — adds exactly one more instance of the object.
 *   - "Set number of instances" — opens an inline numeric field to set the
 *     object's TOTAL instance count directly (native's exact wording for
 *     this action, confirmed via OrcaSlicer's localization strings).
 *
 * Rendered by ThreeViewport when `contextMenu.isOpen` is true (opened via
 * the canvas's native `contextmenu` event on a plate object — see
 * ThreeViewport's handleContextMenu). Closes on any click outside the
 * menu, Escape, or after an action is taken.
 */
export const ObjectContextMenu: React.FC = () => {
  const contextMenu = useStore((state) => state.contextMenu);
  const closeContextMenu = useStore((state) => state.closeContextMenu);
  const removeFile = useStore((state) => state.removeFile);
  const duplicateObject = useStore((state) => state.duplicateObject);
  const setInstanceCount = useStore((state) => state.setInstanceCount);
  const uploadedFiles = useStore((state) => state.uploadedFiles);
  const setSelectedObjectId = useStore((state) => state.setSelectedObjectId);

  const [isEditingInstances, setIsEditingInstances] = useState(false);
  const [instanceInput, setInstanceInput] = useState('1');
  const menuRef = useRef<HTMLDivElement>(null);
  const instanceInputRef = useRef<HTMLInputElement>(null);

  const target = uploadedFiles.find((f) => f.file_id === contextMenu.targetFileId);
  const instanceCount = target
    ? uploadedFiles.filter((f) => f.source_file_id === target.source_file_id).length
    : 1;

  // Reset the inline editor whenever a new menu is opened for a (possibly
  // different) object.
  useEffect(() => {
    setIsEditingInstances(false);
    setInstanceInput(String(instanceCount));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextMenu.targetFileId, contextMenu.isOpen]);

  useEffect(() => {
    if (isEditingInstances) {
      instanceInputRef.current?.focus();
      instanceInputRef.current?.select();
    }
  }, [isEditingInstances]);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!contextMenu.isOpen) return;

    const handlePointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeContextMenu();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeContextMenu();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu.isOpen, closeContextMenu]);

  const handleRemove = useCallback(() => {
    if (!contextMenu.targetFileId) return;
    removeFile(contextMenu.targetFileId);
    closeContextMenu();
  }, [contextMenu.targetFileId, removeFile, closeContextMenu]);

  const handleClone = useCallback(() => {
    if (!contextMenu.targetFileId) return;
    const newId = duplicateObject(contextMenu.targetFileId);
    if (newId) setSelectedObjectId(newId);
    closeContextMenu();
  }, [contextMenu.targetFileId, duplicateObject, setSelectedObjectId, closeContextMenu]);

  const handleOpenInstanceEditor = useCallback(() => {
    setIsEditingInstances(true);
  }, []);

  const handleApplyInstanceCount = useCallback(() => {
    if (!contextMenu.targetFileId) return;
    const parsed = parseInt(instanceInput, 10);
    if (Number.isFinite(parsed) && parsed >= 1) {
      setInstanceCount(contextMenu.targetFileId, parsed);
    }
    closeContextMenu();
  }, [contextMenu.targetFileId, instanceInput, setInstanceCount, closeContextMenu]);

  const handleInstanceInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleApplyInstanceCount();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeContextMenu();
      }
    },
    [handleApplyInstanceCount, closeContextMenu]
  );

  if (!contextMenu.isOpen || !contextMenu.targetFileId) return null;

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Object context menu"
      className="fixed z-50 min-w-[220px] bg-gray-800 border border-gray-600 rounded-md shadow-xl py-1 text-sm"
      style={{ left: contextMenu.position.x, top: contextMenu.position.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        role="menuitem"
        onClick={handleRemove}
        className="w-full flex items-center gap-2 px-3 py-2 text-left text-gray-200 hover:bg-gray-700 transition-colors"
      >
        <Trash2 className="w-4 h-4 text-red-400" />
        Remove
      </button>

      <button
        role="menuitem"
        onClick={handleClone}
        className="w-full flex items-center gap-2 px-3 py-2 text-left text-gray-200 hover:bg-gray-700 transition-colors"
      >
        <Copy className="w-4 h-4 text-gray-400" />
        Clone
      </button>

      <div className="border-t border-gray-700 my-1" />

      {isEditingInstances ? (
        <div className="flex items-center gap-2 px-3 py-2">
          <Layers className="w-4 h-4 text-gray-400 flex-shrink-0" />
          <label htmlFor="instance-count-input" className="text-gray-300 whitespace-nowrap">
            Instances
          </label>
          <input
            id="instance-count-input"
            ref={instanceInputRef}
            type="number"
            min={1}
            step={1}
            value={instanceInput}
            onChange={(e) => setInstanceInput(e.target.value)}
            onKeyDown={handleInstanceInputKeyDown}
            onBlur={handleApplyInstanceCount}
            className="w-16 px-2 py-1 bg-gray-700 text-white rounded text-sm border border-gray-600 focus:outline-none focus:ring-1 focus:ring-purple-400"
          />
        </div>
      ) : (
        <button
          role="menuitem"
          onClick={handleOpenInstanceEditor}
          className="w-full flex items-center gap-2 px-3 py-2 text-left text-gray-200 hover:bg-gray-700 transition-colors"
        >
          <Layers className="w-4 h-4 text-gray-400" />
          Set number of instances&hellip;
          <span className="ml-auto text-gray-500">{instanceCount}</span>
        </button>
      )}
    </div>
  );
};
