import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Competitions from './Competitions';
import { api } from '../../api/client';

// Mocked so this never touches a real backend.
vi.mock('../../api/client', () => ({
  api: { get: vi.fn() },
}));

// Competitions renders <TopBar>, which calls useAuth() for its logout button
// — same mock BetTicket.test.jsx uses, needed here for the same reason.
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ logout: vi.fn() }),
}));

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

describe('Competitions', () => {
  it('shows the pool size for each competition (FEAT-036)', async () => {
    api.get.mockResolvedValueOnce({ competitions: [makeCompetition({ pool: { totalPool: '15000.00' } })] });
    render(<MemoryRouter><Competitions /></MemoryRouter>);

    expect(await screen.findByText('Alpha vs Bravo')).toBeInTheDocument();
    expect(screen.getByText(/Pool ₦15,000/)).toBeInTheDocument();
  });

  it("shows the Boardman's name and trust score when available (FEAT-048)", async () => {
    api.get.mockResolvedValueOnce({
      competitions: [makeCompetition({ boardman: { name: 'Tunde', location: 'Lagos', trustScore: 92, completedCompetitions: 10 } })],
    });
    render(<MemoryRouter><Competitions /></MemoryRouter>);

    expect(await screen.findByText(/Run by Tunde/)).toBeInTheDocument();
    expect(screen.getByText('Trust 92')).toBeInTheDocument();
  });

  it('surfaces a pool edge-case notice (FEAT-038)', async () => {
    api.get.mockResolvedValueOnce({
      competitions: [
        makeCompetition({
          pool: { totalPool: '2000.00', notices: [{ code: 'ONE_SIDED', message: 'Every stake so far is on one option. If it stays that way, everyone is refunded and no commission is taken.' }] },
        }),
      ],
    });
    render(<MemoryRouter><Competitions /></MemoryRouter>);

    expect(await screen.findByText(/Every stake so far is on one option/)).toBeInTheDocument();
  });

  it('shows no pool notices when the pool is balanced', async () => {
    api.get.mockResolvedValueOnce({ competitions: [makeCompetition()] });
    render(<MemoryRouter><Competitions /></MemoryRouter>);

    await screen.findByText('Alpha vs Bravo');
    expect(screen.queryByText(/refunded/)).not.toBeInTheDocument();
  });

  it('loads the unfiltered list immediately on mount (FEAT-043)', async () => {
    api.get.mockResolvedValueOnce({ competitions: [] });
    render(<MemoryRouter><Competitions /></MemoryRouter>);

    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/competitions'));
  });

  it('searches by title/player as the Better types, debounced (FEAT-043)', async () => {
    api.get.mockResolvedValue({ competitions: [] });
    render(<MemoryRouter><Competitions /></MemoryRouter>);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/competitions'));

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'Tunde' } });

    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/competitions?q=Tunde'));
  });

  it('filters by category (FEAT-043)', async () => {
    api.get.mockResolvedValue({ competitions: [] });
    render(<MemoryRouter><Competitions /></MemoryRouter>);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/competitions'));

    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'SNOOKER' } });

    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/competitions?category=SNOOKER'));
  });

  it('filters by location (FEAT-043)', async () => {
    api.get.mockResolvedValue({ competitions: [] });
    render(<MemoryRouter><Competitions /></MemoryRouter>);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/competitions'));

    fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'Lagos' } });

    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/competitions?location=Lagos'));
  });

  it('shows a filter-specific empty state once a filter is active (FEAT-043)', async () => {
    api.get.mockResolvedValue({ competitions: [] });
    render(<MemoryRouter><Competitions /></MemoryRouter>);
    await screen.findByText('No open competitions right now. Check back soon.');

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'Zzz' } });

    expect(await screen.findByText('No open competitions match your filters.')).toBeInTheDocument();
  });
});
