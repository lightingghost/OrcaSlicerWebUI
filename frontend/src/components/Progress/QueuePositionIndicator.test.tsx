import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueuePositionIndicator } from './QueuePositionIndicator';

describe('QueuePositionIndicator', () => {
  it('renders queue position when provided', () => {
    render(<QueuePositionIndicator queuePosition={3} />);
    
    expect(screen.getByText('Job Queued')).toBeInTheDocument();
    expect(screen.getByText('Position 3 in queue')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument(); // badge
  });

  it('shows special message when position is 1', () => {
    render(<QueuePositionIndicator queuePosition={1} />);
    
    expect(screen.getByText('Your job is next in line')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument(); // badge
  });

  it('does not render when queuePosition is null', () => {
    const { container } = render(<QueuePositionIndicator queuePosition={null} />);
    
    expect(container.firstChild).toBeNull();
  });

  it('does not render when queuePosition is undefined', () => {
    const { container } = render(<QueuePositionIndicator queuePosition={undefined} />);
    
    expect(container.firstChild).toBeNull();
  });

  it('does not render when queuePosition is 0', () => {
    const { container } = render(<QueuePositionIndicator queuePosition={0} />);
    
    expect(container.firstChild).toBeNull();
  });

  it('has purple color scheme', () => {
    const { container } = render(<QueuePositionIndicator queuePosition={2} />);
    
    const indicator = container.querySelector('.border-purple-500');
    expect(indicator).toBeInTheDocument();
    
    const badge = container.querySelector('.bg-purple-500');
    expect(badge).toBeInTheDocument();
  });

  it('displays clock icon', () => {
    const { container } = render(<QueuePositionIndicator queuePosition={5} />);
    
    const icon = container.querySelector('svg');
    expect(icon).toBeInTheDocument();
    expect(icon).toHaveClass('text-purple-400');
  });

  it('displays position badge with correct styling', () => {
    const { container } = render(<QueuePositionIndicator queuePosition={7} />);
    
    const badge = container.querySelector('.rounded-full.bg-purple-500.bg-opacity-20');
    expect(badge).toBeInTheDocument();
    
    const badgeText = screen.getAllByText('7').find(el => el.tagName === 'SPAN');
    expect(badgeText).toHaveClass('text-lg', 'font-bold', 'text-purple-300');
  });

  it('renders high queue positions correctly', () => {
    render(<QueuePositionIndicator queuePosition={99} />);
    
    expect(screen.getByText('Position 99 in queue')).toBeInTheDocument();
    expect(screen.getByText('99')).toBeInTheDocument();
  });

  it('has correct layout with icon, text, and badge', () => {
    const { container } = render(<QueuePositionIndicator queuePosition={4} />);
    
    // Check for flex container with justify-between
    const flexContainer = container.querySelector('.flex.items-center.justify-between');
    expect(flexContainer).toBeInTheDocument();
    
    // Check for icon and text group
    const iconTextGroup = container.querySelector('.flex.items-center');
    expect(iconTextGroup).toBeInTheDocument();
    
    // Check for badge
    const badge = container.querySelector('.h-10.w-10.rounded-full');
    expect(badge).toBeInTheDocument();
  });

  it('has correct background and border styling', () => {
    const { container } = render(<QueuePositionIndicator queuePosition={2} />);
    
    const indicator = container.querySelector('.bg-purple-900.bg-opacity-30.border.border-purple-500');
    expect(indicator).toBeInTheDocument();
  });
});
