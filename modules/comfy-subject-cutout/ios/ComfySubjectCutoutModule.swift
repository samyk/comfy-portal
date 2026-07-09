import CoreImage
import ExpoModulesCore
import UIKit
import Vision

public class ComfySubjectCutoutModule: Module {
  private let ciContext = CIContext()

  public func definition() -> ModuleDefinition {
    Name("ComfySubjectCutout")

    AsyncFunction("createSubjectCutoutAsync") { (sourceUrl: URL) -> [String: Any] in
      return try self.createSubjectCutout(from: sourceUrl)
    }
  }

  private func createSubjectCutout(from sourceUrl: URL) throws -> [String: Any] {
    guard #available(iOS 17.0, *) else {
      throw NSError(
        domain: "ComfySubjectCutout",
        code: 1,
        userInfo: [NSLocalizedDescriptionKey: "Subject cutout requires iOS 17 or newer."]
      )
    }

    guard let sourceImage = UIImage(contentsOfFile: sourceUrl.path),
          let cgSourceImage = sourceImage.cgImage else {
      throw NSError(
        domain: "ComfySubjectCutout",
        code: 2,
        userInfo: [NSLocalizedDescriptionKey: "Unable to load image for subject cutout."]
      )
    }

    let imageOrientation = CGImagePropertyOrientation(sourceImage.imageOrientation)
    let inputImage = CIImage(cgImage: cgSourceImage).oriented(imageOrientation)
    let requestHandler = VNImageRequestHandler(
      cgImage: cgSourceImage,
      orientation: imageOrientation,
      options: [:]
    )
    let request = VNGenerateForegroundInstanceMaskRequest()
    try requestHandler.perform([request])

    guard let observation = request.results?.first, !observation.allInstances.isEmpty else {
      throw NSError(
        domain: "ComfySubjectCutout",
        code: 3,
        userInfo: [NSLocalizedDescriptionKey: "No foreground subject was detected."]
      )
    }

    let maskBuffer = try observation.generateScaledMaskForImage(
      forInstances: observation.allInstances,
      from: requestHandler
    )
    let maskImage = CIImage(cvPixelBuffer: maskBuffer)
    let transparentBackground = CIImage(color: .clear).cropped(to: inputImage.extent)

    guard let blendFilter = CIFilter(name: "CIBlendWithMask") else {
      throw NSError(
        domain: "ComfySubjectCutout",
        code: 4,
        userInfo: [NSLocalizedDescriptionKey: "Unable to create subject mask filter."]
      )
    }

    blendFilter.setValue(inputImage, forKey: kCIInputImageKey)
    blendFilter.setValue(transparentBackground, forKey: kCIInputBackgroundImageKey)
    blendFilter.setValue(maskImage, forKey: kCIInputMaskImageKey)

    guard let outputImage = blendFilter.outputImage?.cropped(to: inputImage.extent) else {
      throw NSError(
        domain: "ComfySubjectCutout",
        code: 5,
        userInfo: [NSLocalizedDescriptionKey: "Unable to render subject cutout."]
      )
    }

    let outputExtent = transparentBounds(in: outputImage) ?? outputImage.extent.integral
    guard let cgImage = ciContext.createCGImage(outputImage, from: outputExtent) else {
      throw NSError(
        domain: "ComfySubjectCutout",
        code: 5,
        userInfo: [NSLocalizedDescriptionKey: "Unable to render subject cutout."]
      )
    }

    let output = UIImage(cgImage: cgImage)
    guard let pngData = output.pngData() else {
      throw NSError(
        domain: "ComfySubjectCutout",
        code: 6,
        userInfo: [NSLocalizedDescriptionKey: "Unable to encode subject cutout."]
      )
    }

    let outputUrl = try makeOutputUrl()
    try pngData.write(to: outputUrl, options: .atomic)

    return [
      "uri": outputUrl.absoluteString,
      "width": cgImage.width,
      "height": cgImage.height
    ]
  }

  private func makeOutputUrl() throws -> URL {
    let cacheDirectory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
    let outputDirectory = cacheDirectory.appendingPathComponent("subject-cutouts", isDirectory: true)
    try FileManager.default.createDirectory(at: outputDirectory, withIntermediateDirectories: true)
    return outputDirectory
      .appendingPathComponent(UUID().uuidString)
      .appendingPathExtension("png")
  }

  private func transparentBounds(in image: CIImage) -> CGRect? {
    let extent = image.extent.integral
    let width = Int(extent.width)
    let height = Int(extent.height)
    guard width > 0, height > 0 else {
      return nil
    }

    let bytesPerPixel = 4
    let bytesPerRow = width * bytesPerPixel
    var bytes = [UInt8](repeating: 0, count: bytesPerRow * height)
    ciContext.render(
      image,
      toBitmap: &bytes,
      rowBytes: bytesPerRow,
      bounds: extent,
      format: .RGBA8,
      colorSpace: CGColorSpaceCreateDeviceRGB()
    )

    var minX = width
    var minY = height
    var maxX = -1
    var maxY = -1

    for y in 0..<height {
      for x in 0..<width {
        let alpha = bytes[(y * bytesPerRow) + (x * bytesPerPixel) + 3]
        if alpha > 8 {
          minX = min(minX, x)
          minY = min(minY, y)
          maxX = max(maxX, x)
          maxY = max(maxY, y)
        }
      }
    }

    guard maxX >= minX, maxY >= minY else {
      return nil
    }

    let padding = 8
    minX = max(0, minX - padding)
    minY = max(0, minY - padding)
    maxX = min(width - 1, maxX + padding)
    maxY = min(height - 1, maxY + padding)

    return CGRect(
      x: extent.origin.x + CGFloat(minX),
      y: extent.origin.y + CGFloat(height - maxY - 1),
      width: CGFloat(maxX - minX + 1),
      height: CGFloat(maxY - minY + 1)
    )
  }
}

private extension CGImagePropertyOrientation {
  init(_ orientation: UIImage.Orientation) {
    switch orientation {
    case .up:
      self = .up
    case .upMirrored:
      self = .upMirrored
    case .down:
      self = .down
    case .downMirrored:
      self = .downMirrored
    case .left:
      self = .left
    case .leftMirrored:
      self = .leftMirrored
    case .right:
      self = .right
    case .rightMirrored:
      self = .rightMirrored
    @unknown default:
      self = .up
    }
  }
}
