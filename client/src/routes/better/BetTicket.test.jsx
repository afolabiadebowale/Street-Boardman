import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import BetTicket from './BetTicket';
import { api } from '../../api/client';

// Mocked so this never touches a real backend. api.get supplies the ticket
// on mount; api.post is configured per test for the dispute submission.
vi.mock('../../api/client', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

// BetTicket renders <TopBar>, which calls useAuth() for its logout button
// — same mock Login.test.jsx uses, needed here for the same reason.
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ logout: vi.fn() }),
}));

// Real MemoryRouter + Route, not a mocked useParams — this is how
// App.jsx actually wires :betCode, so the test exercises the real thing.
function renderTicket(betCode = 'SB-000123') {
  return render(
    <MemoryRouter initialEntries={[`/better/my-bets/${betCode}`]}>
      <Routes>
        <Route path="/better/my-bets/:betCode" element={<BetTicket />} />
      </Routes>
    </MemoryRouter>
  );
}

function makeBet({ disputes = [], ...competitionOverrides } = {}) {
  return {
    betCode: 'SB-000123',
    stake: 5000,
    potentialPayout: 9200,
    status: 'OPEN',
    betOption: {
      label: 'Alpha wins',
      competition: {
        id: 'comp-1',
        title: 'Alpha vs Bravo',
        status: 'BETTING_OPEN',
        disputes,
        ...competitionOverrides,
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('BetTicket', () => {
  it('shows the ticket details', async () => {
    api.get.mockResolvedValueOnce({ bet: makeBet() });
    renderTicket();

    expect(await screen.findByText('SB-000123')).toBeInTheDocument();
    expect(screen.getByText('Alpha vs Bravo')).toBeInTheDocument();
    expect(screen.getByText('Alpha wins')).toBeInTheDocument();
  });

  it('does not show a dispute option while betting is still open', async () => {
    api.get.mockResolvedValueOnce({ bet: makeBet({ status: 'BETTING_OPEN' }) });
    renderTicket();

    await screen.findByText('SB-000123');
    expect(screen.queryByRole('heading', { name: 'See a problem with this result?' })).not.toBeInTheDocument();
  });

  it('shows the dispute form once a result is pending confirmation', async () => {
    api.get.mockResolvedValueOnce({ bet: makeBet({ status: 'PENDING_CONFIRMATION' }) });
    renderTicket();

    expect(await screen.findByRole('heading', { name: 'See a problem with this result?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Report a Problem' })).toBeInTheDocument();
  });

  it('submits a dispute and shows a confirmation banner', async () => {
    api.get
      .mockResolvedValueOnce({ bet: makeBet({ status: 'PENDING_CONFIRMATION' }) })
      // reload() after raising it — the server now reflects the dispute
      // it just created, same as a real raiseDispute response would.
      .mockResolvedValueOnce({
        bet: makeBet({ status: 'DISPUTED', disputes: [{ id: 'dispute-1', status: 'OPEN' }] }),
      });
    api.post.mockResolvedValueOnce({ dispute: { id: 'dispute-1' } });
    renderTicket();

    await screen.findByRole('heading', { name: 'See a problem with this result?' });
    fireEvent.change(screen.getByLabelText("What's wrong?"), {
      target: { value: 'Alpha clearly won this match.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Report a Problem' }));

    expect(
      await screen.findByText('Dispute raised. Payouts are frozen until a Platform Admin reviews it.')
    ).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/competitions/comp-1/dispute', {
      reason: 'Alpha clearly won this match.',
    });
    expect(screen.queryByRole('button', { name: 'Report a Problem' })).not.toBeInTheDocument();
  });

  it('shows an existing dispute status on a fresh page load — not just right after submitting', async () => {
    // Simulates the Better leaving and coming back later: the dispute
    // comes straight from the first (and only) api.get call, with no
    // local "just submitted" state involved.
    api.get.mockResolvedValueOnce({
      bet: makeBet({ status: 'DISPUTED', disputes: [{ id: 'dispute-1', status: 'UNDER_REVIEW' }] }),
    });
    renderTicket();

    expect(
      await screen.findByText('A Platform Admin is reviewing this dispute. Payouts stay frozen until they decide.')
    ).toBeInTheDocument();
    // Already disputed — reporting again isn't offered.
    expect(screen.queryByRole('button', { name: 'Report a Problem' })).not.toBeInTheDocument();
  });

  it('shows the outcome once an Admin resolves the dispute', async () => {
    api.get.mockResolvedValueOnce({
      bet: makeBet({ status: 'RESULT_CONFIRMED', disputes: [{ id: 'dispute-1', status: 'RESOLVED_CONFIRMED' }] }),
    });
    renderTicket();

    expect(
      await screen.findByText('An Admin reviewed this dispute and confirmed the result — payouts have been processed.')
    ).toBeInTheDocument();
  });

  it('shows an error and keeps the form visible if raising the dispute fails', async () => {
    api.get.mockResolvedValueOnce({ bet: makeBet({ status: 'PENDING_CONFIRMATION' }) });
    api.post.mockRejectedValueOnce(new Error('This result can no longer be disputed'));
    renderTicket();

    await screen.findByRole('heading', { name: 'See a problem with this result?' });
    fireEvent.change(screen.getByLabelText("What's wrong?"), { target: { value: 'Something is off.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Report a Problem' }));

    expect(await screen.findByText('This result can no longer be disputed')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Report a Problem' })).toBeInTheDocument());
  });
});
