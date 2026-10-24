const fs = require('fs');
const path = require('path');
const {
  withAndroidManifest,
  withDangerousMod,
  withAppBuildGradle,
  AndroidConfig,
} = require('expo/config-plugins');

// Copies the Glance widgets from targets/android-widgets into android/ on every prebuild.
const SOURCE_DIR = 'targets/android-widgets';
const PACKAGE = 'com.owaiskhan.monthlyplanning';

// each name has a <Name>Receiver class, res/xml/widget_<name>.xml and a widget_<name>_label string
const WIDGETS = ['radial', 'year', 'progress', 'streak', 'today', 'goals', 'quote', 'deadlines'];

const withWidgetSources = (config) =>
  withDangerousMod(config, [
    'android',
    (cfg) => {
      const root = path.join(cfg.modRequest.projectRoot, SOURCE_DIR);
      const androidMain = path.join(cfg.modRequest.platformProjectRoot, 'app/src/main');
      const kotlinTo = path.join(androidMain, 'java', ...PACKAGE.split('.'), 'widgets');
      fs.cpSync(path.join(root, 'kotlin'), kotlinTo, { recursive: true });
      fs.cpSync(path.join(root, 'res'), path.join(androidMain, 'res'), { recursive: true });
      return cfg;
    },
  ]);

const withWidgetReceivers = (config) =>
  withAndroidManifest(config, (cfg) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    application.receiver = (application.receiver ?? []).filter(
      (r) => !(r.$?.['android:name'] ?? '').startsWith(`${PACKAGE}.widgets.`)
    );

    for (const name of WIDGETS) {
      const receiver = `${name[0].toUpperCase()}${name.slice(1)}Receiver`;
      application.receiver.push({
        $: {
          'android:name': `${PACKAGE}.widgets.${receiver}`,
          'android:exported': 'true',
          'android:label': `@string/widget_${name}_label`,
        },
        'intent-filter': [
          { action: [{ $: { 'android:name': 'android.appwidget.action.APPWIDGET_UPDATE' } }] },
        ],
        'meta-data': [
          {
            $: {
              'android:name': 'android.appwidget.provider',
              'android:resource': `@xml/widget_${name}`,
            },
          },
        ],
      });
    }
    return cfg;
  });

// Glance needs the Compose compiler at the project's Kotlin version, which Expo's template leaves off.
const withGlanceDependency = (config) =>
  withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.contents.includes('androidx.glance:glance-appwidget')) return cfg;

    cfg.modResults.contents = cfg.modResults.contents.replace(
      /dependencies\s?{/,
      `dependencies {
    implementation "androidx.glance:glance-appwidget:1.1.1"`
    );

    const composeCompiler = `buildscript {
    repositories { mavenCentral() }
    dependencies {
        classpath("org.jetbrains.kotlin.plugin.compose:org.jetbrains.kotlin.plugin.compose.gradle.plugin:\${rootProject.ext.kotlinVersion}")
    }
}
apply plugin: "org.jetbrains.kotlin.plugin.compose"

`;
    // a second android {} block merges with the first, which is less brittle than splicing into it
    cfg.modResults.contents =
      composeCompiler +
      cfg.modResults.contents +
      `
android {
    buildFeatures {
        compose true
    }
}
`;
    return cfg;
  });

module.exports = (config) =>
  withGlanceDependency(withWidgetReceivers(withWidgetSources(config)));
