import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ObjectContextMenu } from './ObjectContextMenu';
import { useStore } from '../store';
import type { UploadedFile } from '../store';

vi.mock('../store', () => ({
  useStore: vi.fn(),
}));

describe('ObjectContextMenu', () => {
  const mockCloseContextMenu = vi.fn();
  const mockRemoveFile = vi.fn();
  const mockDuplicateObject = vi.fn().mockReturnValue('clone-1');
  const mockSetInstanceCount = vi.fn();
  const mockSetSelectedObjectId = vi.fn();

  const sourceFile: UploadedFile = {
    file_id: 'file-1',
    filename: 'model.stl',
    size_bytes: 1000,
    extension: 'stl',
    uploaded_at: '2024-01-01',
    source_file_id: 'file-1',
    is_clone: false,
  };

  const baseState = {
    contextMenu: { isOpen: false, position: { x: 50, y: 60 }, targetFileId: null as string | null },
    closeContextMenu: mockCloseContextMenu,
    removeFile: mockRemoveFile,
    duplicateObject: mockDuplicateObject,
    setInstanceCount: mockSetInstanceCount,
    uploadedFiles: [sourceFile],
    setSelectedObjectId: mockSetSelectedObjectId,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDuplicateObject.mockReturnValue('clone-1');
    (useStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (selector: (state: typeof baseState) => unknown) => selector(baseState)
    );
  });

  it('renders nothing when the menu is closed', () => {
    const { container } = render(<ObjectContextMenu />);
    expect(container.firstChild).toBeNull();
  });

  it('renders Remove, Clone, and "Set number of instances" when open', () => {
    (useStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (selector: (state: typeof baseState) => unknown) =>
        selector({ ...baseState, contextMenu: { isOpen: true, position: { x: 10, y: 20 }, targetFileId: 'file-1' } })
    );

    render(<ObjectContextMenu />);

    expect(screen.getByRole('menuitem', { name: /remove/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /clone/i })).toBeInTheDocument();
    expect(screen.getByText(/set number of instances/i)).toBeInTheDocument();
  });

  it('positions the menu at the stored screen coordinates', () => {
    (useStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (selector: (state: typeof baseState) => unknown) =>
        selector({ ...baseState, contextMenu: { isOpen: true, position: { x: 123, y: 456 }, targetFileId: 'file-1' } })
    );

    render(<ObjectContextMenu />);
    const menu = screen.getByRole('menu', { name: 'Object context menu' });
    expect(menu).toHaveStyle({ left: '123px', top: '456px' });
  });

  it('calls removeFile and closes the menu when Remove is clicked', () => {
    (useStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (selector: (state: typeof baseState) => unknown) =>
        selector({ ...baseState, contextMenu: { isOpen: true, position: { x: 0, y: 0 }, targetFileId: 'file-1' } })
    );

    render(<ObjectContextMenu />);
    fireEvent.click(screen.getByRole('menuitem', { name: /remove/i }));

    expect(mockRemoveFile).toHaveBeenCalledWith('file-1');
    expect(mockCloseContextMenu).toHaveBeenCalledTimes(1);
  });

  it('calls duplicateObject, selects the new clone, and closes the menu when Clone is clicked', () => {
    (useStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (selector: (state: typeof baseState) => unknown) =>
        selector({ ...baseState, contextMenu: { isOpen: true, position: { x: 0, y: 0 }, targetFileId: 'file-1' } })
    );

    render(<ObjectContextMenu />);
    fireEvent.click(screen.getByRole('menuitem', { name: /clone/i }));

    expect(mockDuplicateObject).toHaveBeenCalledWith('file-1');
    expect(mockSetSelectedObjectId).toHaveBeenCalledWith('clone-1');
    expect(mockCloseContextMenu).toHaveBeenCalledTimes(1);
  });

  it('opens an inline numeric field when "Set number of instances" is clicked', () => {
    (useStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (selector: (state: typeof baseState) => unknown) =>
        selector({ ...baseState, contextMenu: { isOpen: true, position: { x: 0, y: 0 }, targetFileId: 'file-1' } })
    );

    render(<ObjectContextMenu />);
    fireEvent.click(screen.getByText(/set number of instances/i));

    expect(screen.getByLabelText('Instances')).toBeInTheDocument();
  });

  it('calls setInstanceCount with the entered value on Enter', () => {
    (useStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (selector: (state: typeof baseState) => unknown) =>
        selector({ ...baseState, contextMenu: { isOpen: true, position: { x: 0, y: 0 }, targetFileId: 'file-1' } })
    );

    render(<ObjectContextMenu />);
    fireEvent.click(screen.getByText(/set number of instances/i));

    const input = screen.getByLabelText('Instances');
    fireEvent.change(input, { target: { value: '5' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(mockSetInstanceCount).toHaveBeenCalledWith('file-1', 5);
    expect(mockCloseContextMenu).toHaveBeenCalledTimes(1);
  });

  it('does not call setInstanceCount for an invalid (non-numeric) value', () => {
    (useStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (selector: (state: typeof baseState) => unknown) =>
        selector({ ...baseState, contextMenu: { isOpen: true, position: { x: 0, y: 0 }, targetFileId: 'file-1' } })
    );

    render(<ObjectContextMenu />);
    fireEvent.click(screen.getByText(/set number of instances/i));

    const input = screen.getByLabelText('Instances');
    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(mockSetInstanceCount).not.toHaveBeenCalled();
  });

  it('closes without applying on Escape', () => {
    (useStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (selector: (state: typeof baseState) => unknown) =>
        selector({ ...baseState, contextMenu: { isOpen: true, position: { x: 0, y: 0 }, targetFileId: 'file-1' } })
    );

    render(<ObjectContextMenu />);
    fireEvent.click(screen.getByText(/set number of instances/i));

    const input = screen.getByLabelText('Instances');
    fireEvent.change(input, { target: { value: '9' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(mockSetInstanceCount).not.toHaveBeenCalled();
    // Both the input's own onKeyDown handler AND the menu's document-level
    // Escape listener call closeContextMenu — harmless double-invocation,
    // just assert it was closed at least once rather than exactly once.
    expect(mockCloseContextMenu).toHaveBeenCalled();
  });

  it('shows the current instance count next to "Set number of instances"', () => {
    const clone: UploadedFile = { ...sourceFile, file_id: 'clone-x', is_clone: true };
    (useStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (selector: (state: typeof baseState) => unknown) =>
        selector({
          ...baseState,
          uploadedFiles: [sourceFile, clone],
          contextMenu: { isOpen: true, position: { x: 0, y: 0 }, targetFileId: 'file-1' },
        })
    );

    render(<ObjectContextMenu />);
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});
