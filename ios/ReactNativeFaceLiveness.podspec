require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'ReactNativeFaceLiveness'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = 'UNLICENSED'
  s.author         = 'Bumpti'
  s.homepage       = package['homepage']
  # The AWS FaceLiveness Swift package requires iOS 15.
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/Bumpti/react-native-face-liveness.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # The AWS SDK ships only as a Swift package; React Native's helper adds it to
  # this pod's target. AWSPluginsCore (the credentials protocols) comes from the
  # same dependency graph; the URL matches the one FaceLiveness declares.
  spm_dependency(s,
    url: 'https://github.com/aws-amplify/amplify-ui-swift-liveness.git',
    requirement: { kind: 'upToNextMajorVersion', minimumVersion: '1.6.0' },
    products: ['FaceLiveness']
  )
  spm_dependency(s,
    url: 'https://github.com/aws-amplify/amplify-swift',
    requirement: { kind: 'upToNextMajorVersion', minimumVersion: '2.60.2' },
    products: ['AWSPluginsCore']
  )

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = '*.swift'
  # The SDK reads its strings from the app's main bundle first, so the
  # translations go there (not into a resource bundle).
  s.resources = ['Localization/*.lproj']
end
