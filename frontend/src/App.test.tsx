import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';

describe('App', () => {
  it('renders without crashing', () => {
    render(<App />);
    // The TopBar renders tab navigation; Prepare is always the first/default tab
    expect(screen.getByRole('tab', { name: 'Prepare' })).toBeDefined();
  });

  it('renders the slicer page by default', () => {
    render(<App />);
    // The default route renders the Prepare tab as selected
    expect(screen.getByRole('tab', { name: 'Prepare' })).toHaveAttribute('aria-selected', 'true');
  });
});
