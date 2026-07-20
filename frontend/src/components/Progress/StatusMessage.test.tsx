import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusMessage } from './StatusMessage';

describe('StatusMessage', () => {
  it('renders the provided message', () => {
    render(<StatusMessage message="Slicing plate 1..." />);
    
    expect(screen.getByText('Slicing plate 1...')).toBeInTheDocument();
  });

  it('renders a default message when empty string is provided', () => {
    render(<StatusMessage message="" />);
    
    expect(screen.getByText('Processing...')).toBeInTheDocument();
  });

  it('renders status icon with pulse animation', () => {
    const { container } = render(<StatusMessage message="Working..." />);
    
    const icon = container.querySelector('.animate-pulse');
    expect(icon).toBeInTheDocument();
    expect(icon).toHaveClass('text-blue-400');
  });

  it('displays info icon with correct styling', () => {
    const { container } = render(<StatusMessage message="Test message" />);
    
    const icon = container.querySelector('svg');
    expect(icon).toBeInTheDocument();
    expect(icon).toHaveClass('h-5', 'w-5', 'text-blue-400');
  });

  it('has correct background styling', () => {
    const { container } = render(<StatusMessage message="Test" />);
    
    const messageContainer = container.querySelector('.rounded-lg.bg-gray-800');
    expect(messageContainer).toBeInTheDocument();
  });

  it('renders long messages correctly', () => {
    const longMessage = 'This is a very long status message that contains detailed information about the current slicing operation and should wrap properly within the container without breaking the layout';
    
    render(<StatusMessage message={longMessage} />);
    
    expect(screen.getByText(longMessage)).toBeInTheDocument();
  });

  it('renders special characters in messages', () => {
    const messageWithSpecialChars = 'Processing file "model_v2.0" @ 100% speed...';
    
    render(<StatusMessage message={messageWithSpecialChars} />);
    
    expect(screen.getByText(messageWithSpecialChars)).toBeInTheDocument();
  });
});
