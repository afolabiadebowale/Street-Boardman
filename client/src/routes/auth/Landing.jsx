import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/button';

// FEAT-049 pilot screen: migrated off the old .landing/.role-choice/.btn
// classes onto Tailwind utilities + the shared Button primitive, as the
// first proof of the new design system. Text, roles, and link targets
// are unchanged, so Landing.test.jsx didn't need to change.
export default function Landing() {
  return (
    <div className="px-4 py-10 text-center">
      <h1 className="mb-4 mt-1 text-[28px]">StreetBoardman</h1>
      <p className="text-sm text-muted">The digital street Boardman — local competitions, real bets, honest payouts.</p>

      <div className="mt-8">
        <Button asChild variant="primary">
          <Link to="/register/better">BETTER</Link>
        </Button>
        <p className="text-sm text-muted">Place bets on local competitions</p>

        <Button asChild variant="secondary" className="mt-5">
          <Link to="/register/boardman">BECOME A BOARDMAN</Link>
        </Button>
        <p className="text-sm text-muted">Create and manage local competitions</p>

        <Link to="/login" className="mt-6 block text-primary">
          Already have an account? Log in
        </Link>
      </div>
    </div>
  );
}
