require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'ComfySubjectCutout'
  s.version        = package['version']
  s.summary        = 'iOS subject cutout support for Comfy Portal stickers'
  s.description    = 'Uses Vision foreground instance masks to create transparent PNG subject cutouts.'
  s.author         = 'Comfy Portal'
  s.homepage       = 'https://github.com'
  s.license        = 'MIT'
  s.platforms      = { :ios => '16.0' }
  s.source         = { :path => '.' }
  s.source_files   = 'ios/**/*.{swift,h,m,mm}'
  s.swift_version  = '5.0'
  s.dependency 'ExpoModulesCore'
end
