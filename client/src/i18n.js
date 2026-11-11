import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import common from './locales/en/common.json';
import auth from './locales/en/auth.json';
import better from './locales/en/better.json';
import boardman from './locales/en/boardman.json';
import admin from './locales/en/admin.json';

// FEAT-053: resources are bundled here (not loaded via an HTTP backend
// plugin) so translation is synchronous — no loading flicker, no act()
// warnings from async resource fetches in tests. Only English exists
// today; a second language is added by dropping in its own resource
// files here, no component changes needed.
i18next.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  defaultNS: 'common',
  resources: {
    en: { common, auth, better, boardman, admin },
  },
  interpolation: { escapeValue: false },
});

document.documentElement.lang = i18next.language;

export default i18next;
