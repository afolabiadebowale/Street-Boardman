import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TransactionHistory from './TransactionHistory';
import { api } from '../../api/client';

vi.mock('../../api/client', () => ({
  api: { get: vi.fn() },
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ logout: vi.fn() }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TransactionHistory', () => {
  it('lists transactions', async () => {
    api.get.mockResolvedValueOnce({
      transactions: [{ id: 't1', type: 'BET_STAKE', amount: -5000, balanceAfter: 10000, createdAt: '2026-01-15T00:00:00.000Z' }],
    });
    render(<MemoryRouter><TransactionHistory /></MemoryRouter>);

    expect(await screen.findByText('BET STAKE')).toBeInTheDocument();
  });

  it('offers a CSV statement download for the chosen month (FEAT-044)', async () => {
    api.get.mockResolvedValueOnce({ transactions: [] });
    render(<MemoryRouter><TransactionHistory /></MemoryRouter>);

    const currentMonth = new Date().toISOString().slice(0, 7);
    const link = await screen.findByRole('link', { name: 'Download CSV' });
    expect(link).toHaveAttribute('href', `/api/wallet/me/statement?month=${currentMonth}`);

    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '2026-01' } });
    expect(screen.getByRole('link', { name: 'Download CSV' })).toHaveAttribute(
      'href',
      '/api/wallet/me/statement?month=2026-01'
    );
  });

  it("falls back to the current month if the month field holds anything other than YYYY-MM (CodeQL js/xss-through-dom)", async () => {
    api.get.mockResolvedValueOnce({ transactions: [] });
    render(<MemoryRouter><TransactionHistory /></MemoryRouter>);

    const currentMonth = new Date().toISOString().slice(0, 7);
    await screen.findByRole('link', { name: 'Download CSV' });

    // type="month" never lets a real user type this, but nothing stops a
    // synthetic/dispatched change event from carrying an arbitrary string —
    // the href must never be built from that unchecked.
    fireEvent.change(screen.getByLabelText('Month'), { target: { value: 'javascript:alert(1)' } });

    expect(screen.getByRole('link', { name: 'Download CSV' })).toHaveAttribute(
      'href',
      `/api/wallet/me/statement?month=${currentMonth}`
    );
  });
});
