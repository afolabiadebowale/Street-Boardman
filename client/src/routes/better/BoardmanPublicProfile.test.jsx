import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import BoardmanPublicProfile from './BoardmanPublicProfile';
import { api } from '../../api/client';

vi.mock('../../api/client', () => ({
  api: { get: vi.fn() },
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ logout: vi.fn() }),
}));

function renderProfile(id = 'boardman-1') {
  return render(
    <MemoryRouter initialEntries={[`/better/boardmen/${id}`]}>
      <Routes>
        <Route path="/better/boardmen/:id" element={<BoardmanPublicProfile />} />
      </Routes>
    </MemoryRouter>
  );
}

function makeBoardman(overrides = {}) {
  return {
    profileId: 'boardman-1',
    name: 'Tunde',
    location: 'Lagos',
    memberSince: '2025-01-15T00:00:00.000Z',
    trustScore: 92,
    track: {
      completedCompetitions: 40,
      disputedCompetitions: 2,
      resultsOverturned: 1,
      cancelledByBoardman: 1,
      totalStakedOnCompleted: '500000.00',
    },
    scoreExplained: 'Completed competitions, weighed against results thrown out...',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('BoardmanPublicProfile', () => {
  it("shows the Boardman's name, location and trust score", async () => {
    api.get.mockResolvedValueOnce({ boardman: makeBoardman() });
    renderProfile();

    expect(await screen.findByText('Lagos')).toBeInTheDocument();
    expect(screen.getByText('Trust 92')).toBeInTheDocument();
  });

  it('shows the track record', async () => {
    api.get.mockResolvedValueOnce({ boardman: makeBoardman() });
    renderProfile();

    await screen.findByText('Lagos');
    expect(screen.getByText('40')).toBeInTheDocument();
    expect(screen.getByText('₦500,000')).toBeInTheDocument();
  });

  it('explains why there is no trust score yet for a new Boardman', async () => {
    api.get.mockResolvedValueOnce({ boardman: makeBoardman({ trustScore: null }) });
    renderProfile();

    expect(await screen.findByText(/New Boardman/)).toBeInTheDocument();
    expect(screen.queryByText(/^Trust /)).not.toBeInTheDocument();
  });

  it('shows an error if the Boardman cannot be found', async () => {
    api.get.mockRejectedValueOnce(new Error('Boardman not found'));
    renderProfile();

    expect(await screen.findByText('Boardman not found')).toBeInTheDocument();
  });
});
