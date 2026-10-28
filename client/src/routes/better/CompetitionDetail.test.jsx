import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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

function makeCompetition({ pool, boardman = null, ...overrides } = {}) {
  return {
    id: 'comp-1',
    title: 'Alpha vs Bravo',
    category: 'FOOTBALL',
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
  it('shows the pool size (FEAT-036)', async () => {
    api.get.mockResolvedValueOnce({ competition: makeCompetition({ pool: { totalPool: '15000.00' } }) });
    renderDetail();

    expect(await screen.findByText('Alpha vs Bravo')).toBeInTheDocument();
    expect(screen.getByText(/Pool so far: ₦15,000/)).toBeInTheDocument();
  });

  it('shows per-option payout odds next to each choice (FEAT-036)', async () => {
    api.get.mockResolvedValueOnce({
      competition: makeCompetition({
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
    expect(screen.getByText('₦100 → ₦180.00')).toBeInTheDocument();
    expect(screen.getByText('₦100 → ₦140.00')).toBeInTheDocument();
  });

  it("shows the Boardman's name and trust score (FEAT-048)", async () => {
    api.get.mockResolvedValueOnce({
      competition: makeCompetition({ boardman: { name: 'Tunde', location: 'Lagos', trustScore: 92 } }),
    });
    renderDetail();

    expect(await screen.findByText(/Run by Tunde · Lagos/)).toBeInTheDocument();
    expect(screen.getByText('Trust 92')).toBeInTheDocument();
  });

  it('surfaces a pool edge-case notice as a banner (FEAT-038)', async () => {
    api.get.mockResolvedValueOnce({
      competition: makeCompetition({
        pool: { totalPool: '0.00', notices: [{ code: 'EMPTY_POOL', message: 'No bets yet. Returns appear once people start betting.' }] },
      }),
    });
    renderDetail();

    expect(await screen.findByText('No bets yet. Returns appear once people start betting.')).toBeInTheDocument();
  });

  it('shows no notice banner when the pool has none', async () => {
    api.get.mockResolvedValueOnce({ competition: makeCompetition() });
    renderDetail();

    await screen.findByText('Alpha vs Bravo');
    expect(screen.queryByText(/refunded/)).not.toBeInTheDocument();
  });
});
