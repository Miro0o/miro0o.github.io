#!/usr/bin/env swift

import Foundation
import ImageIO
import UniformTypeIdentifiers

guard CommandLine.arguments.count == 7 else {
    fputs("Usage: write-photo-metadata.swift INPUT OUTPUT ISO_DATE LATITUDE LONGITUDE QUALITY\n", stderr)
    exit(2)
}

let input = URL(fileURLWithPath: CommandLine.arguments[1])
let output = URL(fileURLWithPath: CommandLine.arguments[2])
let isoDate = CommandLine.arguments[3]
guard let latitude = Double(CommandLine.arguments[4]),
      let longitude = Double(CommandLine.arguments[5]),
      let quality = Double(CommandLine.arguments[6]),
      let source = CGImageSourceCreateWithURL(input as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil),
      let destination = CGImageDestinationCreateWithURL(
        output as CFURL,
        UTType.jpeg.identifier as CFString,
        1,
        nil
      ) else {
    fputs("Could not read the source image or create the JPEG destination.\n", stderr)
    exit(1)
}

let inputFormatter = ISO8601DateFormatter()
guard let date = inputFormatter.date(from: isoDate) else {
    fputs("Invalid ISO date: \(isoDate)\n", stderr)
    exit(2)
}
let exifFormatter = DateFormatter()
exifFormatter.locale = Locale(identifier: "en_US_POSIX")
exifFormatter.timeZone = TimeZone(secondsFromGMT: -7 * 3600)
exifFormatter.dateFormat = "yyyy:MM:dd HH:mm:ss"
let exifDate = exifFormatter.string(from: date)

let properties: [CFString: Any] = [
    kCGImageDestinationLossyCompressionQuality: quality,
    kCGImagePropertyExifDictionary: [
        kCGImagePropertyExifDateTimeOriginal: exifDate,
        kCGImagePropertyExifDateTimeDigitized: exifDate
    ],
    kCGImagePropertyTIFFDictionary: [
        kCGImagePropertyTIFFDateTime: exifDate,
        kCGImagePropertyTIFFMake: "Apple",
        kCGImagePropertyTIFFModel: "iPhone 12"
    ],
    kCGImagePropertyGPSDictionary: [
        kCGImagePropertyGPSLatitude: abs(latitude),
        kCGImagePropertyGPSLatitudeRef: latitude >= 0 ? "N" : "S",
        kCGImagePropertyGPSLongitude: abs(longitude),
        kCGImagePropertyGPSLongitudeRef: longitude >= 0 ? "E" : "W",
        kCGImagePropertyGPSAltitude: 40.214,
        kCGImagePropertyGPSAltitudeRef: 0
    ]
]

CGImageDestinationAddImage(destination, image, properties as CFDictionary)
guard CGImageDestinationFinalize(destination) else {
    fputs("Could not finish the JPEG image.\n", stderr)
    exit(1)
}
