import Foundation
import ImageIO

guard CommandLine.arguments.count == 2 else {
    fputs("Usage: read-image-gps.swift IMAGE\n", stderr)
    exit(2)
}

let url = URL(fileURLWithPath: CommandLine.arguments[1]) as CFURL
guard
    let source = CGImageSourceCreateWithURL(url, nil),
    let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as NSDictionary?,
    let gps = properties[kCGImagePropertyGPSDictionary] as? NSDictionary,
    let latitudeNumber = gps[kCGImagePropertyGPSLatitude] as? NSNumber,
    let longitudeNumber = gps[kCGImagePropertyGPSLongitude] as? NSNumber
else {
    exit(3)
}

var latitude = latitudeNumber.doubleValue
var longitude = longitudeNumber.doubleValue
if (gps[kCGImagePropertyGPSLatitudeRef] as? String)?.uppercased() == "S" { latitude *= -1 }
if (gps[kCGImagePropertyGPSLongitudeRef] as? String)?.uppercased() == "W" { longitude *= -1 }
print("\(latitude),\(longitude)")
