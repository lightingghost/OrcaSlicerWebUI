import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WarningBanner } from './WarningBanner';

describe('WarningBanner', () => {
  it('renders warning message when provided', () => {
    render(<WarningBanner warning="Temperature threshold exceeded" />);
    
    expect(screen.getByText('Warning')).toBeInTheDocument();
    expect(screen.getByText('Temperature threshold exceeded')).toBeInTheDocument();
  });

  it('does not render when warning is null', () => {
    const { container } = render(<WarningBanner warning={null} />);
    
    expect(container.firstChild).toBeNull();
  });

  it('does not render when warning is undefined', () => {
    const { container } = render(<WarningBanner warning={undefined} />);
    
    expect(container.firstChild).toBeNull();
  });

  it('does not render when warning is empty string', () => {
    const { container } = render(<WarningBanner warning="" />);
    
    expect(container.firstChild).toBeNull();
  });

  it('has amber/yellow color scheme', () => {
    const { container } = render(<WarningBanner warning="Test warning" />);
    
    const banner = container.querySelector('.border-amber-500');
    expect(banner).toBeInTheDocument();
    
    const warningLabel = screen.getByText('Warning');
    expect(warningLabel).toHaveClass('text-amber-300');
  });

  it('displays warning icon', () => {
    const { container } = render(<WarningBanner warning="Test" />);
    
    const icon = container.querySelector('svg');
    expect(icon).toBeInTheDocument();
    expect(icon).toHaveClass('text-amber-500');
  });

  it('renders multi-line warnings correctly', () => {
    const multiLineWarning = 'Line 1\nLine 2\nLine 3';
    
    render(<WarningBanner warning={multiLineWarning} />);
    
    // Use a text matcher function to handle multi-line text
    expect(screen.getByText((content, element) => {
      return element?.textContent === multiLineWarning;
    })).toBeInTheDocument();
  });

  it('renders long warning messages correctly', () => {
    const longWarning = 'This is a very long warning message that should wrap properly within the banner container without breaking the layout or causing overflow issues';
    
    render(<WarningBanner warning={longWarning} />);
    
    expect(screen.getByText(longWarning)).toBeInTheDocument();
  });

  it('has correct background and border styling', () => {
    const { container } = render(<WarningBanner warning="Warning text" />);
    
    const banner = container.querySelector('.bg-amber-900.bg-opacity-30.border.border-amber-500');
    expect(banner).toBeInTheDocument();
  });

  it('shows warning triangle icon with correct path', () => {
    const { container } = render(<WarningBanner warning="Test" />);
    
    const icon = container.querySelector('svg path');
    expect(icon).toBeInTheDocument();
    // Triangle warning icon path includes specific coordinates
    expect(icon?.getAttribute('d')).toContain('M12');
  });
});
