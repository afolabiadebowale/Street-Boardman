import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import CompetitionDetail from './CompetitionDetail';
import { api } from '../../api/client';

// Mocked so this never touches a real backend.
vi.mock('../../api/client', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

// CompetitionDetail renders <TopBar>, which calls useAuth() for its logout
// button — same mock BetTicket.test.jsx uses, needed here for the same reason.
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ logout: vi.fn() }),
}));

// Real MemoryRouter + Route, not a mocked useParams — mirrors how App.jsx
// actually wires :id, same approach BetTicket.test.jsx uses for :betCode.
function renderDetail(id = 'comp-1') {
  return render(
    <MemoryRouter initialEntries={[`/better/competitions/${id}`]}>
      <Routes>
        <Route path="/better/competitions/:id" element={<CompetitionDetail />} />
      </Routes>
    </MemoryRouter>
  );
}

function makeCompetition({ pool, boardman = null, status = 'BETTING_OPEN', ...overrides } = {}) {
  return {
    id: 'comp-1',
    title: 'Alpha vs Bravo',
    category: 'FOOTBALL',
    status,
    bettingDeadline: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    betOptions: [{ id: 'opt-1', label: 'Alpha' }, { id: 'opt-2', label: 'Bravo' }],
    boardman,
    pool: { totalPool: '0.00', options: [], notices: [], ...pool },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CompetitionDetail', () => {
  it('shows the pot size (FEAT-036, reworded for pot honesty)', async () => {
    api.get.mockResolvedValueOnce({ competition: makeCompetition({ pool: { totalPool: '15000.00' } }) });
    renderDetail();

    expect(await screen.findByText('Alpha vs Bravo')).toBeInTheDocument();
    expect(screen.getByText(/₦15,000 in the pot so far/)).toBeInTheDocument();
  });

  it('hides per-option payout odds while betting is open — no confident number, just the pot notice', async () => {
    api.get.mockResolvedValueOnce({
      competition: makeCompetition({
        status: 'BETTING_OPEN',
        pool: {
          totalPool: '10000.00',
          options: [
            { id: 'opt-1', payoutPer100: '180.00' },
            { id: 'opt-2', payoutPer100: '140.00' },
          ],
        },
      }),
    });
    renderDetail();

    await screen.findByText('Alpha vs Bravo');
    expect(screen.queryByText(/₦100 →/)).not.toBeInTheDocument();
    expect(screen.getByText(/check back once betting closes/)).toBeInTheDocument();
  });

  it('shows the locked per-option payout once betting has closed', async () => {
    api.get.mockResolvedValueOnce({
      competition: makeCompetition({
        status: 'BETTING_CLOSED',
        pool: {
          totalPool: '10000.00',
          options: [
            { id: 'opt-1', payoutPer100: '180.00' },
            { id: 'opt-2', payoutPer100: '140.00' },
          ],
        },
      }),
    });
    renderDetail();

    await screen.findByText('Alpha vs Bravo');
    expect(screen.getByText('Locked: ₦100 → ₦180.00')).toBeInTheDocument();
    expect(screen.getByText('Locked: ₦100 → ₦140.00')).toBeInTheDocument();
    // The pot notice ("check back once betting closes") no longer applies.
    expect(screen.queryByText(/check back once betting closes/)).not.toBeInTheDocument();
  });

  it("shows the Boardman's name and trust score (FEAT-048)", async () => {
    api.get.mockResolvedValueOnce({
      competition: makeCompetition({ boardman: { profileId: 'bm-1', name: 'Tunde', location: 'Lagos', trustScore: 92 } }),
    });
    renderDetail();

    // "Tunde" is a <Link>, a separate text node from "Run by"/"Lagos" (FEAT-048 profile link).
    expect(await screen.findByRole('link', { name: 'Tunde' })).toBeInTheDocument();
    expect(screen.getByText(/· Lagos/)).toBeInTheDocument();
    expect(screen.getByText('Trust 92')).toBeInTheDocument();
  });

  it("links the Boardman's name to the right profile id (FEAT-048)", async () => {
    api.get.mockResolvedValueOnce({
      competition: makeCompetition({ boardman: { profileId: 'bm-1', name: 'Tunde', location: 'Lagos', trustScore: 92 } }),
    });
    renderDetail();

    expect(await screen.findByRole('link', { name: 'Tunde' })).toHaveAttribute('href', '/better/boardmen/bm-1');
  });

  it('surfaces a pool edge-case notice as a banner (FEAT-038)', async () => {
    api.get.mockResolvedValueOnce({
      competition: makeCompetition({
        pool: { totalPool: '0.00', notices: [{ code: 'EMPTY_POOL', message: 'The pot is empty — be the first to stake. Payouts appear once people start betting.' }] },
      }),
    });
    renderDetail();

    expect(await screen.findByText('The pot is empty — be the first to stake. Payouts appear once people start betting.')).toBeInTheDocument();
  });

  it('shows no notice banner when the pool has none', async () => {
    api.get.mockResolvedValueOnce({ competition: makeCompetition() });
    renderDetail();

    await screen.findByText('Alpha vs Bravo');
    expect(screen.queryByText(/refunded/)).not.toBeInTheDocument();
  });

  it('reviews before placing the bet, instead of submitting immediately (FEAT-037)', async () => {
    api.get.mockResolvedValueOnce({
      competition: makeCompetition({ pool: { totalPool: '10000.00', options: [{ id: 'opt-1', payoutPer100: '180.00' }] } }),
    });
    renderDetail();

    await screen.findByText('Alpha vs Bravo');
    // The stake field's <label> isn't programmatically associated with its
    // <input> (pre-existing — a11y labeling is tracked separately under
    // EPIC-011), so select it by placeholder instead. Select the radio by
    // position since both options render identically while betting is open.
    fireEvent.click(screen.getAllByRole('radio')[0]);
    fireEvent.change(screen.getByPlaceholderText('e.g. 5000'), { target: { value: '2000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review Bet' }));

    expect(await screen.findByText('Confirm your bet')).toBeInTheDocument();
    expect(screen.getByText('₦2,000')).toBeInTheDocument();
    // No payout figure is shown pre-confirmation — just the pot notice.
    expect(screen.getByText(/check back once betting closes/)).toBeInTheDocument();
    // The bet isn't placed just by reviewing it.
    expect(api.post).not.toHaveBeenCalled();
  });

  it('only calls the API once the review is confirmed', async () => {
    api.get.mockResolvedValueOnce({
      competition: makeCompetition({ pool: { totalPool: '10000.00', options: [{ id: 'opt-1', payoutPer100: '180.00' }] } }),
    });
    api.post.mockResolvedValueOnce({ bet: { betCode: 'SB-000999' } });
    renderDetail();

    await screen.findByText('Alpha vs Bravo');
    fireEvent.click(screen.getAllByRole('radio')[0]);
    fireEvent.change(screen.getByPlaceholderText('e.g. 5000'), { target: { value: '2000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review Bet' }));
    await screen.findByText('Confirm your bet');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Bet' }));

    await vi.waitFor(() => expect(api.post).toHaveBeenCalledWith('/bets', { betOptionId: 'opt-1', stake: 2000 }));
  });

  it('lets the Better go back and change the bet before confirming', async () => {
    api.get.mockResolvedValueOnce({
      competition: makeCompetition({ pool: { totalPool: '10000.00', options: [{ id: 'opt-1', payoutPer100: '180.00' }] } }),
    });
    renderDetail();

    await screen.findByText('Alpha vs Bravo');
    fireEvent.click(screen.getAllByRole('radio')[0]);
    fireEvent.change(screen.getByPlaceholderText('e.g. 5000'), { target: { value: '2000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review Bet' }));
    await screen.findByText('Confirm your bet');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    expect(await screen.findByText('Choose your bet')).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });
});
