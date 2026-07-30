import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { JobOptionsModal } from './JobOptionsModal';

// The modal fetches the backend version via apiClient.getHealth() — mock
// it so tests control the response instead of hitting a real backend.
vi.mock('../../api/client', () => ({
  apiClient: {
    getHealth: vi.fn(),
  },
}));

import { apiClient } from '../../api/client';

describe('JobOptionsModal', () => {
  beforeEach(() => {
    vi.mocked(apiClient.getHealth).mockReset();
  });

  it('renders nothing when closed', () => {
    render(<JobOptionsModal isOpen={false} onClose={() => {}} />);
    expect(screen.queryByText('Job Options')).not.toBeInTheDocument();
  });

  it('shows the frontend version immediately and the backend version once /health resolves', async () => {
    vi.mocked(apiClient.getHealth).mockResolvedValue({
      status: 'healthy',
      version: '0.1.0',
      cli_available: true,
      workspace_accessible: true,
    });

    render(<JobOptionsModal isOpen={true} onClose={() => {}} />);

    // Frontend version (injected via __APP_VERSION__ — see vitest.config.ts)
    // is known synchronously, before the backend's own /health round trip
    // resolves.
    expect(screen.getByTestId('app-versions').textContent).toContain('frontend v0.1.0');

    await waitFor(() => {
      expect(screen.getByTestId('app-versions').textContent).toContain('backend v0.1.0');
    });
  });

  it('falls back to a placeholder for the backend version if /health fails', async () => {
    vi.mocked(apiClient.getHealth).mockRejectedValue(new Error('network error'));

    render(<JobOptionsModal isOpen={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(apiClient.getHealth).toHaveBeenCalled();
    });
    // Never resolves to a real version — stays at the "…" placeholder
    // rather than crashing or showing a stale/undefined value.
    expect(screen.getByTestId('app-versions').textContent).toContain('backend v…');
  });

  it('always shows advanced options with no expand/collapse toggle', async () => {
    vi.mocked(apiClient.getHealth).mockResolvedValue({
      status: 'healthy',
      version: '0.1.0',
      cli_available: true,
      workspace_accessible: true,
    });

    render(<JobOptionsModal isOpen={true} onClose={() => {}} />);

    expect(screen.getByText('Advanced Options')).toBeInTheDocument();
    // AdvancedPanel's fields are visible immediately, not behind a toggle.
    expect(screen.getByLabelText('Data Directory')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /advanced options/i })).not.toBeInTheDocument();

    // Let the getHealth() promise settle so its state update isn't left
    // dangling past the end of the test (avoids the act() warning).
    await waitFor(() => expect(apiClient.getHealth).toHaveBeenCalled());
  });
});
