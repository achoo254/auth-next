import SwiftUI

/// Colours come from the asset catalog (`Brand*` colour sets, light and
/// dark), generated from `static/css/tokens.css` by
/// `ios/scripts/sync-colors.mjs`; Xcode generates the `Color.brand…`
/// symbols. Spacing follows the `--space-*` scale of the same file.
enum Spacing {
    static let xs: CGFloat = 4
    static let sm: CGFloat = 8
    static let md: CGFloat = 12
    static let lg: CGFloat = 16
    static let xl: CGFloat = 24
    static let xxl: CGFloat = 32
}

enum Radius {
    static let sm: CGFloat = 8
    static let md: CGFloat = 12
    static let lg: CGFloat = 16
}
