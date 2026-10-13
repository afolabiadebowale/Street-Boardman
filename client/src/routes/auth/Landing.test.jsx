import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Landing from './Landing';

// Landing uses react-router-dom's <Link>, which throws without a Router
// context, so it's rendered inside a MemoryRouter here the same way App.jsx
// provides a real Router at runtime.
function renderLanding() {
  return render(
    <MemoryRouter>
      <Landing />
    </MemoryRouter>
  );
}

describe('Landing', () => {
  it('shows the two registration choices with the correct destinations', () => {
    renderLanding();

    expect(screen.getByRole('heading', { name: 'StreetBoardman' })).toBeInTheDocument();

    const betterLink = screen.getByRole('link', { name: 'BETTER' });
    expect(betterLink).toHaveAttribute('href', '/register/better');

    const boardmanLink = screen.getByRole('link', { name: 'BECOME A BOARDMAN' });
    expect(boardmanLink).toHaveAttribute('href', '/register/boardman');
  });

  it('offers a way to log in for people who already have an account', () => {
    renderLanding();

    const loginLink = screen.getByRole('link', { name: 'Already have an account? Log in' });
    expect(loginLink).toHaveAttribute('href', '/login');
  });
});
