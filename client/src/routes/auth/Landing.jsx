import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/button';

// FEAT-049 pilot screen: migrated off the old .landing/.role-choice/.btn
// classes onto Tailwind utilities + the shared Button primitive, as the
// first proof of the new design system. Text, roles, and link targets
// are unchanged, so Landing.test.jsx didn't need to change.
export default function Landing() {
  const { t } = useTranslation('auth');
  return (
    <div className="px-4 py-10 text-center">
      <h1 className="mb-4 mt-1 text-[28px]">{t('landing.title')}</h1>
      <p className="text-sm text-muted">{t('landing.tagline')}</p>

      <div className="mt-8">
        <Button asChild variant="primary">
          <Link to="/register/better">{t('landing.betterCta')}</Link>
        </Button>
        <p className="text-sm text-muted">{t('landing.betterHint')}</p>

        <Button asChild variant="secondary" className="mt-5">
          <Link to="/register/boardman">{t('landing.boardmanCta')}</Link>
        </Button>
        <p className="text-sm text-muted">{t('landing.boardmanHint')}</p>

        <Link to="/login" className="mt-6 block text-primary">
          {t('landing.loginLink')}
        </Link>
      </div>
    </div>
  );
}
