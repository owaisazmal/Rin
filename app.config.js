/**
 * Everything static lives in app.json; this exists for the one thing that
 * can't. Firebase's two config files are gitignored, so their paths differ
 * between a checkout (repo root) and an EAS build (wherever EAS writes a file
 * environment variable). Reading them from the environment lets both work
 * without either putting the files in the repo.
 *
 * See .env.example for the variable names.
 */
module.exports = ({ config }) => ({
  ...config,
  ios: {
    ...config.ios,
    googleServicesFile: process.env.GOOGLE_SERVICE_INFO_PLIST ?? config.ios.googleServicesFile,
  },
  android: {
    ...config.android,
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? config.android.googleServicesFile,
  },
});
