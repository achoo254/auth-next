// Renders the 1024×1024 iOS app icon from ios/brand/app-icon.webp, the app's
// own AI-drawn picture (a user inside a shield). The web pages keep the
// ecosystem logo of brand/app-icon.svg; the iOS app has its own mark so it does
// not look like the hoandat.com home screen shortcut. ImageIO decodes the WebP
// and Core Graphics scales it onto an opaque canvas, as App Store icons must
// be. Run from the repo root:
//   swift ios/scripts/render-app-icon.swift
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let size = 1024
let source = URL(fileURLWithPath: "ios/brand/app-icon.webp")
let output = URL(fileURLWithPath: "ios/AccountApp/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon.png")

guard
    let picture = CGImageSourceCreateWithURL(source as CFURL, nil),
    let art = CGImageSourceCreateImageAtIndex(picture, 0, nil)
else { fatalError("cannot read \(source.path)") }

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
