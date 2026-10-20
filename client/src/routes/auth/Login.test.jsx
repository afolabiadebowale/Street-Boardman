import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Login from './Login';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';

// Mocked so this test never touches a real backend or AuthProvider (which
// would itself call the API on mount). Each test configures api.post's
// resolved/rejected value per step.
vi.mock('../../api/client', () => ({
  api: { post: vi.fn(), get: vi.fn() },
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

// Login uses react-router-dom's <Link>, which needs a Router context, same
// reason Landing.test.jsx wraps in MemoryRouter.
function renderLogin() {
  return render(
    <MemoryRouter>
      <Login />
    </MemoryRouter>
  );
}

// The phone and PIN <label>s aren't associated with their <input>s via
// htmlFor/id (same quirk e2e/fixtures.js already works around), so they
// aren't queryable by label text. Scoped by type instead, same pattern.
function getPhoneInput() {
  return screen.getByRole('textbox');
}
function getPinInput(container) {
  return container.querySelector('input[type="password"]');
}

function submitPinForm(container, { phone = '08022222222', pin = 'Better@12345' } = {}) {
  fireEvent.change(getPhoneInput(), { target: { value: phone } });
  fireEvent.change(getPinInput(container), { target: { value: pin } });
  fireEvent.click(screen.getByRole('button', { name: 'Log In' }));
}

let refreshSpy;

beforeEach(() => {
  vi.clearAllMocks();
  refreshSpy = vi.fn().mockResolvedValue(undefined);
  useAuth.mockReturnValue({ refresh: refreshSpy });
});

describe('Login — PIN step', () => {
  it('renders the phone/PIN form by default', () => {
    renderLogin();
    expect(screen.getByRole('heading', { name: 'Log In' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log In' })).toBeInTheDocument();
  });

  it('logs in and routes a Better to /better on success', async () => {
    api.post.mockResolvedValueOnce({ user: { role: 'BETTER' } });
    const { container } = renderLogin();

    submitPinForm(container, { phone: '08022222222', pin: 'Better@12345' });

    await waitFor(() => expect(refreshSpy).toHaveBeenCalled());
    expect(api.post).toHaveBeenCalledWith('/auth/login', { phone: '08022222222', pin: 'Better@12345' });
    expect(mockNavigate).toHaveBeenCalledWith('/better');
  });

  it.each([
    ['ADMIN', '/admin'],
    ['BOARDMAN', '/boardman'],
    ['BETTER', '/better'],
  ])('routes role %s to %s after login', async (role, path) => {
    api.post.mockResolvedValueOnce({ user: { role } });
    const { container } = renderLogin();

    submitPinForm(container);

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith(path));
  });

  it('shows an error and stays on the PIN form when login fails', async () => {
    api.post.mockRejectedValueOnce(new Error('Invalid phone number or PIN'));
    const { container } = renderLogin();

    submitPinForm(container, { phone: '08000000000', pin: 'wrong' });

    expect(await screen.findByText('Invalid phone number or PIN')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Log In' })).toBeInTheDocument();
    expect(refreshSpy).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('shows the 6-digit code screen when the server requires MFA', async () => {
    api.post.mockResolvedValueOnce({ mfaRequired: true, mfaToken: 'challenge-token' });
    const { container } = renderLogin();

    submitPinForm(container);

    expect(await screen.findByRole('heading', { name: 'Enter your code' })).toBeInTheDocument();
    expect(screen.getByLabelText('Authentication code')).toHaveValue('');
    // onSubmitPin clears the PIN field on the mfaRequired branch; going back
    // to the PIN screen should show that, not the previously typed value.
    fireEvent.click(screen.getByRole('button', { name: 'Back to login' }));
    expect(getPinInput(container)).toHaveValue('');
  });
});

describe('Login — MFA code step', () => {
  async function getToCodeScreen(container) {
    api.post.mockResolvedValueOnce({ mfaRequired: true, mfaToken: 'challenge-token' });
    submitPinForm(container);
    return screen.findByLabelText('Authentication code');
  }

  it('strips non-digit characters and caps the code at 6 digits', async () => {
    const { container } = renderLogin();
    const codeInput = await getToCodeScreen(container);

    fireEvent.change(codeInput, { target: { value: '12a3bc4567' } });
    expect(codeInput).toHaveValue('123456');
  });

  it('disables Verify until a full 6-digit code is entered', async () => {
    const { container } = renderLogin();
    const codeInput = await getToCodeScreen(container);

    expect(screen.getByRole('button', { name: 'Verify' })).toBeDisabled();
    fireEvent.change(codeInput, { target: { value: '12345' } });
    expect(screen.getByRole('button', { name: 'Verify' })).toBeDisabled();
    fireEvent.change(codeInput, { target: { value: '123456' } });
    expect(screen.getByRole('button', { name: 'Verify' })).not.toBeDisabled();
  });

  it('verifies the code and logs in on success', async () => {
    const { container } = renderLogin();
    const codeInput = await getToCodeScreen(container);
    fireEvent.change(codeInput, { target: { value: '123456' } });

    api.post.mockResolvedValueOnce({ user: { role: 'ADMIN' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/admin'));
    expect(api.post).toHaveBeenCalledWith('/auth/mfa/verify', {
      mfaToken: 'challenge-token',
      code: '123456',
    });
    expect(refreshSpy).toHaveBeenCalled();
  });

  it('shows an error and clears the code on an invalid MFA code, staying on the code screen', async () => {
    const { container } = renderLogin();
    const codeInput = await getToCodeScreen(container);
    fireEvent.change(codeInput, { target: { value: '000000' } });

    api.post.mockRejectedValueOnce(new Error('Invalid code'));
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));

    expect(await screen.findByText('Invalid code')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Enter your code' })).toBeInTheDocument();
    expect(codeInput).toHaveValue('');
  });

  it('returns to the PIN screen when the MFA challenge has expired', async () => {
    const { container } = renderLogin();
    const codeInput = await getToCodeScreen(container);
    fireEvent.change(codeInput, { target: { value: '123456' } });

    api.post.mockRejectedValueOnce(new Error('MFA challenge expired'));
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));

    expect(await screen.findByRole('heading', { name: 'Log In' })).toBeInTheDocument();
  });
});
