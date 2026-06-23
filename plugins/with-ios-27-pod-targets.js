const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('@expo/config-plugins');

const marker = '# Xcode 27 pod deployment target compatibility';

module.exports = function withIos27PodTargets(config) {
  return withDangerousMod(config, [
    'ios',
    async (modConfig) => {
      const podfilePath = path.join(
        modConfig.modRequest.platformProjectRoot,
        'Podfile'
      );
      let podfile = fs.readFileSync(podfilePath, 'utf8');

      if (podfile.includes(marker)) {
        return modConfig;
      }

      const anchor = '  post_install do |installer|\n';
      const start = podfile.indexOf(anchor);
      if (start === -1) {
        throw new Error('Unable to find post_install in the generated Podfile');
      }

      const reactNativePostInstall = podfile.indexOf(
        '    react_native_post_install(',
        start
      );
      const closingCall = podfile.indexOf('    )\n', reactNativePostInstall);
      if (reactNativePostInstall === -1 || closingCall === -1) {
        throw new Error(
          'Unable to find react_native_post_install in the generated Podfile'
        );
      }

      const insertionPoint = closingCall + '    )\n'.length;
      const compatibilityBlock = `

    ${marker}
    deployment_target = podfile_properties['ios.deploymentTarget'] || '15.1'
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |build_config|
        build_config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = deployment_target
        build_config.build_settings['SWIFT_VERSION'] = '5.0'
        build_config.build_settings['SWIFT_STRICT_CONCURRENCY'] = 'minimal'
      end
    end
`;

      podfile =
        podfile.slice(0, insertionPoint) +
        compatibilityBlock +
        podfile.slice(insertionPoint);
      fs.writeFileSync(podfilePath, podfile);
      return modConfig;
    },
  ]);
};
