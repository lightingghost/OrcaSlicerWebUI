import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';

describe('App', () => {
  it('renders without crashing', () => {
    render(<App />);
    // The Layout should render with the OrcaSlicer Web UI header
    expect(screen.getByText('OrcaSlicer Web UI')).toBeDefined();
  });

  it('renders the slicer page by default', () => {
    render(<App />);
    // The default route should render the SlicerPage
    expect(screen.getByText('Main Slicer UI')).toBeDefined();
  });
});
