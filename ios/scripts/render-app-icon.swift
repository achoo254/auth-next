// Renders the 1024×1024 iOS app icon from brand/app-icon-maskable.svg
// (violet square, white "A"), drawn with Core Graphics so no SVG tool is
// needed. Opaque, as App Store icons must be. Run from the repo root:
//   swift ios/scripts/render-app-icon.swift
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let size = 1024
let scale = CGFloat(size) / 512
let output = URL(fileURLWithPath: "ios/AccountApp/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon.png")

guard let context = CGContext(
    data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
    space: CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB(),
    bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
) else { fatalError("no bitmap context") }

// SVG y grows downwards; flip so the path coordinates can be copied as is.
context.translateBy(x: 0, y: CGFloat(size))
context.scaleBy(x: scale, y: -scale)

// <rect fill="#6e56cf"/> (--c-primary-solid)
context.setFillColor(CGColor(srgbRed: 0x6e / 255, green: 0x56 / 255, blue: 0xcf / 255, alpha: 1))
context.fill(CGRect(x: 0, y: 0, width: 512, height: 512))

// M220 128h72l100 256h-68l-20-56h-96l-20 56h-68z M226 272h60l-30-82z (evenodd)
let glyph = CGMutablePath()
glyph.addLines(between: [
    CGPoint(x: 220, y: 128), CGPoint(x: 292, y: 128), CGPoint(x: 392, y: 384),
    CGPoint(x: 324, y: 384), CGPoint(x: 304, y: 328), CGPoint(x: 208, y: 328),
    CGPoint(x: 188, y: 384), CGPoint(x: 120, y: 384),
])
glyph.closeSubpath()
glyph.addLines(between: [CGPoint(x: 226, y: 272), CGPoint(x: 286, y: 272), CGPoint(x: 256, y: 190)])
glyph.closeSubpath()
context.addPath(glyph)
context.setFillColor(CGColor(srgbRed: 1, green: 1, blue: 1, alpha: 1))
context.fillPath(using: .evenOdd)

guard
    let image = context.makeImage(),
    let destination = CGImageDestinationCreateWithURL(output as CFURL, UTType.png.identifier as CFString, 1, nil)
else { fatalError("cannot write \(output.path)") }
CGImageDestinationAddImage(destination, image, nil)
guard CGImageDestinationFinalize(destination) else { fatalError("cannot write \(output.path)") }
print("Wrote \(output.path)")
