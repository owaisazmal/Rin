// Firebase's config files are gitignored, so EAS builds pass their paths in as file env vars (see .env.example).
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
