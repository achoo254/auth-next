// Renders the 1024×1024 iOS app icon from brand/app-icon.svg. The icon is a
// full-bleed picture (drawn with AI) embedded in the SVG as a base64 data URI
// (the SVG only clips its corners, which iOS rounds itself);
// ImageIO decodes it (WebP or PNG) and Core Graphics scales it onto an opaque
// canvas, as App Store icons must be, so no SVG tool is needed. Run from the
// repo root:
//   swift ios/scripts/render-app-icon.swift
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let size = 1024
let source = URL(fileURLWithPath: "brand/app-icon.svg")
let output = URL(fileURLWithPath: "ios/AccountApp/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon.png")

guard let svg = try? String(contentsOf: source, encoding: .utf8) else { fatalError("cannot read \(source.path)") }
let dataUri = try NSRegularExpression(pattern: #"href="data:image/(?:webp|png);base64,([A-Za-z0-9+/=]+)""#)
guard
    let match = dataUri.firstMatch(in: svg, range: NSRange(svg.startIndex..., in: svg)),
    let base64 = Range(match.range(at: 1), in: svg).map({ String(svg[$0]) }),
    let data = Data(base64Encoded: base64),
    let picture = CGImageSourceCreateWithData(data as CFData, nil),
    let art = CGImageSourceCreateImageAtIndex(picture, 0, nil)
else { fatalError("\(source.path): no embedded WebP/PNG picture to draw") }

guard let context = CGContext(
    data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
    space: CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB(),
    bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
) else { fatalError("no bitmap context") }

context.interpolationQuality = .high
context.draw(art, in: CGRect(x: 0, y: 0, width: size, height: size))

guard
    let image = context.makeImage(),
    let destination = CGImageDestinationCreateWithURL(output as CFURL, UTType.png.identifier as CFString, 1, nil)
else { fatalError("cannot write \(output.path)") }
CGImageDestinationAddImage(destination, image, nil)
guard CGImageDestinationFinalize(destination) else { fatalError("cannot write \(output.path)") }
print("Wrote \(output.path)")
