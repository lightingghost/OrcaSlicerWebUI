import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { UploadDropzone } from './UploadDropzone';
import { useStore } from '../store';

// Mock the store
vi.mock('../store', () => ({
  useStore: vi.fn(),
}));

describe('UploadDropzone', () => {
  const mockUploadFile = vi.fn();
  const mockUseStore = useStore as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Default mock implementation
    mockUseStore.mockImplementation((selector) =>
      selector({
        uploadedFiles: [],
        uploadFile: mockUploadFile,
        uploadError: null,
      })
    );
  });

  it('renders the dropzone when no files are uploaded', () => {
    render(<UploadDropzone />);
    
    expect(screen.getByText(/drag & drop your 3d model/i)).toBeInTheDocument();
    expect(screen.getByText(/or click to browse/i)).toBeInTheDocument();
  });

  it('does not render when files are uploaded', () => {
    mockUseStore.mockImplementation((selector) =>
      selector({
        uploadedFiles: [
          {
            file_id: 'test-123',
            filename: 'test.stl',
            size_bytes: 1000,
            extension: 'stl',
            uploaded_at: new Date().toISOString(),
          },
        ],
        uploadFile: mockUploadFile,
        uploadError: null,
      })
    );

    const { container } = render(<UploadDropzone />);
    expect(container.firstChild).toBeNull();
  });

  it('displays accepted file formats', () => {
    render(<UploadDropzone />);
    
    expect(screen.getByText(/\.STL, \.3MF, \.OBJ, \.AMF/i)).toBeInTheDocument();
  });

  it('displays maximum file size', () => {
    render(<UploadDropzone />);
    
    expect(screen.getByText(/maximum file size: 500 mb/i)).toBeInTheDocument();
  });

  it('shows error for unsupported file extension', async () => {
    render(<UploadDropzone />);
    
    const file = new File(['content'], 'test.txt', { type: 'text/plain' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    
    Object.defineProperty(input, 'files', {
      value: [file],
      writable: false,
    });
    
    fireEvent.change(input);
    
    await waitFor(() => {
      expect(screen.getByText(/unsupported file type/i)).toBeInTheDocument();
    });
    
    expect(mockUploadFile).not.toHaveBeenCalled();
  });

  it('shows error for file exceeding 500 MB', async () => {
    render(<UploadDropzone />);
    
    const largeSize = 501 * 1024 * 1024; // 501 MB
    const file = new File(['content'], 'large.stl', { type: 'model/stl' });
    Object.defineProperty(file, 'size', { value: largeSize, writable: false, configurable: true });
    
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    
    Object.defineProperty(input, 'files', {
      value: [file],
      writable: false,
    });
    
    fireEvent.change(input);
    
    await waitFor(() => {
      expect(screen.getByText(/file too large/i)).toBeInTheDocument();
      expect(screen.getByText(/501\.00 MB/i)).toBeInTheDocument();
    });
    
    expect(mockUploadFile).not.toHaveBeenCalled();
  });

  it('calls uploadFile with valid STL file', async () => {
    mockUploadFile.mockResolvedValue(undefined);
    
    render(<UploadDropzone />);
    
    const file = new File(['stl content'], 'model.stl', { type: 'model/stl' });
    Object.defineProperty(file, 'size', { value: 1024 * 1024 }); // 1 MB
    
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    
    Object.defineProperty(input, 'files', {
      value: [file],
      writable: false,
    });
    
    fireEvent.change(input);
    
    await waitFor(() => {
      expect(mockUploadFile).toHaveBeenCalledWith(file);
    });
  });

  it('calls uploadFile with valid 3MF file', async () => {
    mockUploadFile.mockResolvedValue(undefined);
    
    render(<UploadDropzone />);
    
    const file = new File(['3mf content'], 'model.3mf', { type: 'model/3mf' });
    Object.defineProperty(file, 'size', { value: 1024 * 1024 }); // 1 MB
    
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    
    Object.defineProperty(input, 'files', {
      value: [file],
      writable: false,
    });
    
    fireEvent.change(input);
    
    await waitFor(() => {
      expect(mockUploadFile).toHaveBeenCalledWith(file);
    });
  });

  it('displays store upload error', () => {
    mockUseStore.mockImplementation((selector) =>
      selector({
        uploadedFiles: [],
        uploadFile: mockUploadFile,
        uploadError: 'Network error occurred',
      })
    );

    render(<UploadDropzone />);
    
    expect(screen.getByText('Network error occurred')).toBeInTheDocument();
  });

  it('handles drag enter event', () => {
    render(<UploadDropzone />);
    
    const dropzone = screen.getByText(/drag & drop your 3d model/i).closest('div') as HTMLElement;
    
    // Drag enter should change the text
    fireEvent.dragEnter(dropzone);
    expect(screen.getByText(/drop your file here/i)).toBeInTheDocument();
  });

  it('handles file drop', async () => {
    mockUploadFile.mockResolvedValue(undefined);
    
    render(<UploadDropzone />);
    
    const file = new File(['obj content'], 'model.obj', { type: 'model/obj' });
    Object.defineProperty(file, 'size', { value: 1024 * 1024 }); // 1 MB
    
    const dropzone = screen.getByText(/drag & drop your 3d model/i).closest('div');
    
    const dataTransfer = {
      files: [file],
      items: [],
      types: ['Files'],
    };
    
    fireEvent.drop(dropzone!, { dataTransfer });
    
    await waitFor(() => {
      expect(mockUploadFile).toHaveBeenCalledWith(file);
    });
  });

  it('shows uploading state', async () => {
    mockUploadFile.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 100))
    );
    
    render(<UploadDropzone />);
    
    const file = new File(['amf content'], 'model.amf', { type: 'model/amf' });
    Object.defineProperty(file, 'size', { value: 1024 * 1024 }); // 1 MB
    
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    
    Object.defineProperty(input, 'files', {
      value: [file],
      writable: false,
    });
    
    fireEvent.change(input);
    
    // Should show uploading state
    await waitFor(() => {
      expect(screen.getByText(/uploading\.\.\./i)).toBeInTheDocument();
    });
  });

  it('accepts files with uppercase extensions', async () => {
    mockUploadFile.mockResolvedValue(undefined);
    
    render(<UploadDropzone />);
    
    const file = new File(['stl content'], 'MODEL.STL', { type: 'model/stl' });
    Object.defineProperty(file, 'size', { value: 1024 * 1024 }); // 1 MB
    
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    
    Object.defineProperty(input, 'files', {
      value: [file],
      writable: false,
    });
    
    fireEvent.change(input);
    
    await waitFor(() => {
      expect(mockUploadFile).toHaveBeenCalledWith(file);
    });
  });

  it('validates file exactly at 500 MB limit', async () => {
    mockUploadFile.mockResolvedValue(undefined);
    
    render(<UploadDropzone />);
    
    const exactSize = 500 * 1024 * 1024; // Exactly 500 MB
    const file = new File(['content'], 'exact.stl', { type: 'model/stl' });
    Object.defineProperty(file, 'size', { value: exactSize, writable: false, configurable: true });
    
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    
    Object.defineProperty(input, 'files', {
      value: [file],
      writable: false,
    });
    
    fireEvent.change(input);
    
    await waitFor(() => {
      expect(mockUploadFile).toHaveBeenCalledWith(file);
    });
  });
});
