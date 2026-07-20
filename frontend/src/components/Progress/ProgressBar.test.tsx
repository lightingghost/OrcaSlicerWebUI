import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProgressBar } from './ProgressBar';

describe('ProgressBar', () => {
  it('renders progress bar with correct percentage', () => {
    render(<ProgressBar percent={50} />);
    
    expect(screen.getByText('50.0%')).toBeInTheDocument();
  });

  it('renders 0% correctly', () => {
    render(<ProgressBar percent={0} />);
    
    expect(screen.getByText('0.0%')).toBeInTheDocument();
  });

  it('renders 100% correctly', () => {
    render(<ProgressBar percent={100} />);
    
    expect(screen.getByText('100.0%')).toBeInTheDocument();
  });

  it('clamps negative values to 0%', () => {
    render(<ProgressBar percent={-10} />);
    
    expect(screen.getByText('0.0%')).toBeInTheDocument();
  });

  it('clamps values over 100% to 100%', () => {
    render(<ProgressBar percent={150} />);
    
    expect(screen.getByText('100.0%')).toBeInTheDocument();
  });

  it('formats decimal percentages to one decimal place', () => {
    render(<ProgressBar percent={45.678} />);
    
    expect(screen.getByText('45.7%')).toBeInTheDocument();
  });

  it('applies correct width style based on percentage', () => {
    const { container } = render(<ProgressBar percent={75} />);
    
    const progressFill = container.querySelector('.absolute.inset-y-0.left-0');
    expect(progressFill).toHaveStyle({ width: '75%' });
  });

  it('has correct background gradient classes', () => {
    const { container } = render(<ProgressBar percent={50} />);
    
    const progressFill = container.querySelector('.bg-gradient-to-r.from-blue-500.to-blue-600');
    expect(progressFill).toBeInTheDocument();
  });

  it('has transition classes for smooth animation', () => {
    const { container } = render(<ProgressBar percent={50} />);
    
    const progressFill = container.querySelector('.transition-all.duration-300.ease-out');
    expect(progressFill).toBeInTheDocument();
  });
});
