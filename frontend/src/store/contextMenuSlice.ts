import { StateCreator } from 'zustand';

/**
 * contextMenuSlice
 *
 * State backing the object right-click context menu (see
 * ObjectContextMenu.tsx), matching native OrcaSlicer's object-list
 * right-click menu (src/slic3r/GUI/GUI_ObjectList.cpp) actions:
 *   - "Delete" (here: Remove) — deletes the object from the plate.
 *   - "Clone" — adds exactly one more instance of the object (native calls
 *     this "instance" duplication; the visible label in this app is
 *     "Clone" per the requested wording).
 *   - "Set number of instances" — opens a small numeric prompt to set the
 *     TOTAL instance count for that object directly.
 */
export interface ContextMenuState {
  isOpen: boolean;
  /** Screen position (viewport pixel coordinates) where the menu should render. */
  position: { x: number; y: number };
  /** The plate object (file_id) the menu was opened for. */
  targetFileId: string | null;
}

export interface ContextMenuSlice {
  contextMenu: ContextMenuState;
  openContextMenu: (fileId: string, position: { x: number; y: number }) => void;
  closeContextMenu: () => void;
}

const DEFAULT_CONTEXT_MENU_STATE: ContextMenuState = {
  isOpen: false,
  position: { x: 0, y: 0 },
  targetFileId: null,
};

export const createContextMenuSlice: StateCreator<ContextMenuSlice> = (set) => ({
  contextMenu: { ...DEFAULT_CONTEXT_MENU_STATE },

  openContextMenu: (fileId, position) => {
    set({ contextMenu: { isOpen: true, position, targetFileId: fileId } });
  },

  closeContextMenu: () => {
    set({ contextMenu: { ...DEFAULT_CONTEXT_MENU_STATE } });
  },
});
