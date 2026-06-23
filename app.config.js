const baseConfig = require('./app.json');

module.exports = () => {
  const config = structuredClone(baseConfig.expo);

  if (process.env.LOCAL_IOS_BUILD === '1') {
    config.ios = {
      ...config.ios,
      bundleIdentifier: 'my.sa.qgen',
      appleTeamId: '729MKH4M8C',
    };

    config.plugins = config.plugins.map((plugin) => {
      const name = Array.isArray(plugin) ? plugin[0] : plugin;
      if (name === 'expo-build-properties') {
        return [
          'expo-build-properties',
          {
            ...plugin[1],
            ios: {
              ...plugin[1].ios,
              deploymentTarget: '16.0',
            },
          },
        ];
      }

      return name === 'expo-sharing'
        ? ['expo-sharing', { ios: { enabled: false } }]
        : plugin;
    });

    if (config.extra?.eas?.build?.experimental?.ios) {
      delete config.extra.eas.build.experimental.ios.appExtensions;
    }
  }

  config.plugins.push('./plugins/with-ios-27-pod-targets');
  return config;
};
