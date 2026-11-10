import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import SharedTicket from './SharedTicket';
import { api } from '../../api/client';

vi.mock('../../api/client', () => ({
  api: { get: vi.fn() },
}));

function renderPage(token = 'tok123') {
  return render(
    <MemoryRouter initialEntries={[`/tickets/${token}`]}>
      <Routes>
        <Route path="/tickets/:token" element={<SharedTicket />} />
      </Routes>
    </MemoryRouter>
  );
}

function makeTicket(overrides = {}) {
  return {
    betCode: 'SB-000123',
    status: 'RESULT_CONFIRMED',
    stake: 5000,
    potentialPayout: 9200,
    placedAt: '2026-01-15T00:00:00.000Z',
    option: 'Alpha wins',
    competition: { title: 'Alpha vs Bravo', category: 'FOOTBALL', status: 'COMPLETED' },
    winningOption: 'Alpha wins',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SharedTicket', () => {
  it('shows what was bet and how it ended, without exposing who placed it', async () => {
    api.get.mockResolvedValueOnce({ ticket: makeTicket() });
    renderPage();

    expect(await screen.findByText('SB-000123')).toBeInTheDocument();
    expect(screen.getByText('Alpha vs Bravo')).toBeInTheDocument();
    // Option and winning result happen to share the same label here.
    expect(screen.getAllByText('Alpha wins')).toHaveLength(2);
    expect(screen.getByText('₦5,000')).toBeInTheDocument();
  });

  it('shows no result row while the competition is still open', async () => {
    api.get.mockResolvedValueOnce({ ticket: makeTicket({ status: 'OPEN', winningOption: null }) });
    renderPage();

    await screen.findByText('SB-000123');
    expect(screen.queryByText('Result')).not.toBeInTheDocument();
  });

  it('shows an error if the ticket is not found', async () => {
    api.get.mockRejectedValueOnce(new Error('Ticket not found'));
    renderPage();

    expect(await screen.findByText('Ticket not found')).toBeInTheDocument();
  });
});
