import AppKit
import Foundation
import ImageIO
import Photos
import UniformTypeIdentifiers
import Vision

struct PhotoRecord: Codable {
    let id: String
    let latitude: Double
    let longitude: Double
    let createdAt: String?
    let modifiedAt: String?
    let width: Int
    let height: Int
    let favorite: Bool
    let hidden: Bool
    let screenshot: Bool
    let livePhoto: Bool
}

struct ScanDocument: Codable {
    let version: Int
    let generatedAt: String
    let totalImages: Int
    let locatedImages: Int
    let photos: [PhotoRecord]
}

struct RankCandidate: Codable {
    let id: String
    let modifiedAt: String?
    let placeId: String
}

struct RankRecord: Codable {
    let id: String
    let modifiedAt: String?
    let aesthetics: Float
    let utility: Bool
    let faceCount: Int
    let largestFaceShare: Double
    let analyzedAt: String
    let error: String?
}

struct ExportRequest: Codable {
    let id: String
    let filename: String
}

struct FavoriteAuditDocument: Codable {
    let generatedAt: String
    let authorizationStatus: String
    let accessibleImages: Int
    let accessibleVideos: Int
    let favoriteImages: Int
    let favoriteImagesWithGPS: Int
    let hiddenFavoriteImages: Int
    let hiddenFavoriteImagesWithGPS: Int
    let favoriteVideos: Int
    let favoriteVideosWithGPS: Int
    let hiddenFavoriteVideos: Int
    let hiddenFavoriteVideosWithGPS: Int
}

struct FavoriteExportFailure: Codable {
    let filename: String
    let reason: String
}

struct FavoriteExportReport: Codable {
    let generatedAt: String
    let requested: Int
    let alreadyPresent: Int
    let exported: Int
    let failed: [FavoriteExportFailure]
}

struct SelectionMatchRecord: Codable {
    let selectedFilename: String
    let photoId: String?
    let method: String
    let distance: Float?
    let runnerUpDistance: Float?
    let status: String
    let exportedFilename: String?
}

struct SelectionMatchReport: Codable {
    let generatedAt: String
    let selected: Int
    let matched: Int
    let exported: Int
    let records: [SelectionMatchRecord]
}

enum IndexerError: LocalizedError {
    case usage(String)
    case denied
    case missingAsset(String)
    case imageUnavailable(String)

    var errorDescription: String? {
        switch self {
        case .usage(let message): return message
        case .denied: return "Photos access was not granted. Allow full Photos access for Miro Travel Photo Indexer in System Settings > Privacy & Security > Photos."
        case .missingAsset(let id): return "Photo asset not found: \(id)"
        case .imageUnavailable(let id): return "A preview could not be loaded for photo: \(id)"
        }
    }
}

private let isoFormatter: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
}()

private func iso(_ date: Date?) -> String? {
    date.map(isoFormatter.string(from:))
}

private func now() -> String {
    isoFormatter.string(from: Date())
}

private func requestPhotosAccess() async -> Bool {
    let current = PHPhotoLibrary.authorizationStatus(for: .readWrite)
    if current == .authorized || current == .limited { return true }
    if current == .denied || current == .restricted { return false }
    let result = await withCheckedContinuation { continuation in
        PHPhotoLibrary.requestAuthorization(for: .readWrite) { status in
            continuation.resume(returning: status)
        }
    }
    return result == .authorized || result == .limited
}

private func authorizationStatusName(_ status: PHAuthorizationStatus) -> String {
    switch status {
    case .notDetermined: return "notDetermined"
    case .restricted: return "restricted"
    case .denied: return "denied"
    case .authorized: return "authorized"
    case .limited: return "limited"
    @unknown default: return "unknown"
    }
}

private func hasUsableLocation(_ asset: PHAsset) -> Bool {
    guard let coordinate = asset.location?.coordinate else { return false }
    return coordinate.latitude.isFinite
        && coordinate.longitude.isFinite
        && abs(coordinate.latitude) <= 90
        && abs(coordinate.longitude) <= 180
        && !(coordinate.latitude == 0 && coordinate.longitude == 0)
}

private func writeJSON<T: Encodable>(_ value: T, to path: String) throws {
    let url = URL(fileURLWithPath: path)
    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    let data = try encoder.encode(value)
    try data.write(to: url, options: .atomic)
}

private func readJSON<T: Decodable>(_ type: T.Type, from path: String) throws -> T {
    try JSONDecoder().decode(type, from: Data(contentsOf: URL(fileURLWithPath: path)))
}

private func fetchAssetMap(ids: [String]) -> [String: PHAsset] {
    let result = PHAsset.fetchAssets(withLocalIdentifiers: ids, options: nil)
    var assets: [String: PHAsset] = [:]
    result.enumerateObjects { asset, _, _ in assets[asset.localIdentifier] = asset }
    return assets
}

private func cgImage(for asset: PHAsset, size: CGFloat, allowNetwork: Bool) -> CGImage? {
    let options = PHImageRequestOptions()
    options.deliveryMode = .highQualityFormat
    options.resizeMode = .fast
    options.isSynchronous = true
    options.isNetworkAccessAllowed = allowNetwork
    options.version = .current

    var result: NSImage?
    PHImageManager.default().requestImage(
        for: asset,
        targetSize: CGSize(width: size, height: size),
        contentMode: .aspectFit,
        options: options
    ) { image, _ in
        if let image { result = image }
    }

    guard let result else { return nil }
    var rect = CGRect(origin: .zero, size: result.size)
    return result.cgImage(forProposedRect: &rect, context: nil, hints: nil)
}

private func originalCGImage(for asset: PHAsset, allowNetwork: Bool) -> CGImage? {
    let options = PHImageRequestOptions()
    options.deliveryMode = .highQualityFormat
    options.isSynchronous = true
    options.isNetworkAccessAllowed = allowNetwork
    options.version = .original

    var imageData: Data?
    PHImageManager.default().requestImageDataAndOrientation(for: asset, options: options) { data, _, _, info in
        if (info?[PHImageResultIsDegradedKey] as? Bool) == true { return }
        imageData = data
    }

    guard let imageData,
          let source = CGImageSourceCreateWithData(imageData as CFData, nil) else { return nil }
    let maximumPixelSize = max(1, max(asset.pixelWidth, asset.pixelHeight))
    let thumbnailOptions: [CFString: Any] = [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceThumbnailMaxPixelSize: maximumPixelSize,
        kCGImageSourceShouldCacheImmediately: true
    ]
    return CGImageSourceCreateThumbnailAtIndex(source, 0, thumbnailOptions as CFDictionary)
}

private func currentImageData(for asset: PHAsset, allowNetwork: Bool) -> (Data, String)? {
    let options = PHImageRequestOptions()
    options.deliveryMode = .highQualityFormat
    options.isSynchronous = true
    options.isNetworkAccessAllowed = allowNetwork
    options.version = .current

    var result: (Data, String)?
    PHImageManager.default().requestImageDataAndOrientation(for: asset, options: options) { data, uti, _, info in
        guard (info?[PHImageResultIsDegradedKey] as? Bool) != true, let data else { return }
        let ext = uti.flatMap { UTType($0)?.preferredFilenameExtension } ?? "jpg"
        result = (data, ext.lowercased())
    }
    return result
}

private func featurePrint(for image: CGImage) throws -> VNFeaturePrintObservation {
    let request = VNGenerateImageFeaturePrintRequest()
    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    try handler.perform([request])
    guard let observation = request.results?.first as? VNFeaturePrintObservation else {
        throw IndexerError.imageUnavailable("feature-print")
    }
    return observation
}

private func sourceCGImage(at url: URL) -> CGImage? {
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
    let options: [CFString: Any] = [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceThumbnailMaxPixelSize: 768
    ]
    return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
}

private let filenameDateFormatter: DateFormatter = {
    let formatter = DateFormatter()
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    formatter.dateFormat = "yyyy-MM-dd-HHmmss"
    return formatter
}()

private func favoriteFilename(for asset: PHAsset) -> String {
    let date = asset.creationDate.map(filenameDateFormatter.string(from:)) ?? "undated"
    let identifier = asset.localIdentifier.split(separator: "/").first.map(String.init) ?? UUID().uuidString
    let safeIdentifier = identifier.replacingOccurrences(
        of: "[^A-Za-z0-9-]",
        with: "-",
        options: .regularExpression
    )
    return "\(date)-\(safeIdentifier).jpg"
}

private func writeImages(_ requests: [ExportRequest], assets: [String: PHAsset], directory: String) throws {
    let root = URL(fileURLWithPath: directory, isDirectory: true)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)

    for (index, request) in requests.enumerated() {
        let destination = root.appendingPathComponent(request.filename)
        guard let asset = assets[request.id] else { throw IndexerError.missingAsset(request.id) }
        guard let image = cgImage(for: asset, size: 1920, allowNetwork: true) else {
            throw IndexerError.imageUnavailable(request.id)
        }
        let bitmap = NSBitmapImageRep(cgImage: image)
        guard let data = bitmap.representation(using: .jpeg, properties: [.compressionFactor: 0.84]) else {
            throw IndexerError.imageUnavailable(request.id)
        }
        try data.write(to: destination, options: .atomic)
        print("Exported \(index + 1)/\(requests.count): \(request.filename)")
    }
}

private func writeOriginalImages(_ requests: [ExportRequest], assets: [String: PHAsset], directory: String) throws {
    let root = URL(fileURLWithPath: directory, isDirectory: true)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)

    for request in requests {
        let destination = root.appendingPathComponent(request.filename)
        if FileManager.default.fileExists(atPath: destination.path) {
            continue
        }
        guard let asset = assets[request.id] else { throw IndexerError.missingAsset(request.id) }
        guard let image = originalCGImage(for: asset, allowNetwork: true) else {
            throw IndexerError.imageUnavailable(request.id)
        }
        let bitmap = NSBitmapImageRep(cgImage: image)
        guard let jpeg = bitmap.representation(using: .jpeg, properties: [.compressionFactor: 0.94]) else {
            throw IndexerError.imageUnavailable(request.id)
        }
        try jpeg.write(to: destination, options: .atomic)
        print("Exported complete original: \(request.filename)")
    }
}

private func scan(output: String) async throws {
    guard await requestPhotosAccess() else { throw IndexerError.denied }

    let options = PHFetchOptions()
    options.includeHiddenAssets = true
    let assets = PHAsset.fetchAssets(with: .image, options: options)
    var photos: [PhotoRecord] = []
    photos.reserveCapacity(assets.count)

    assets.enumerateObjects { asset, _, _ in
        guard let coordinate = asset.location?.coordinate,
              coordinate.latitude.isFinite,
              coordinate.longitude.isFinite,
              abs(coordinate.latitude) <= 90,
              abs(coordinate.longitude) <= 180,
              !(coordinate.latitude == 0 && coordinate.longitude == 0) else { return }

        photos.append(PhotoRecord(
            id: asset.localIdentifier,
            latitude: coordinate.latitude,
            longitude: coordinate.longitude,
            createdAt: iso(asset.creationDate),
            modifiedAt: iso(asset.modificationDate),
            width: asset.pixelWidth,
            height: asset.pixelHeight,
            favorite: asset.isFavorite,
            hidden: asset.isHidden,
            screenshot: asset.mediaSubtypes.contains(.photoScreenshot),
            livePhoto: asset.mediaSubtypes.contains(.photoLive)
        ))
    }

    photos.sort {
        ($0.createdAt ?? "") == ($1.createdAt ?? "")
            ? $0.id < $1.id
            : ($0.createdAt ?? "") < ($1.createdAt ?? "")
    }

    try writeJSON(ScanDocument(
        version: 1,
        generatedAt: now(),
        totalImages: assets.count,
        locatedImages: photos.count,
        photos: photos
    ), to: output)

    print("Scanned \(assets.count) images; \(photos.count) contain usable coordinates.")
    print("Private metadata written to \(output)")
}

private func rank(input: String, output: String, allowNetwork: Bool) async throws {
    guard await requestPhotosAccess() else { throw IndexerError.denied }
    let candidates = try readJSON([RankCandidate].self, from: input)
    let previous: [RankRecord] = (try? readJSON([RankRecord].self, from: output)) ?? []
    var cache = Dictionary(uniqueKeysWithValues: previous.map { ($0.id, $0) })
    let pending = candidates.filter { candidate in
        guard let prior = cache[candidate.id] else { return true }
        return prior.modifiedAt != candidate.modifiedAt || prior.error != nil
    }
    let assets = fetchAssetMap(ids: pending.map(\.id))

    for (index, candidate) in pending.enumerated() {
        fputs("Analyzing \(index + 1)/\(pending.count)\r", stderr)
        guard let asset = assets[candidate.id] else {
            cache[candidate.id] = RankRecord(
                id: candidate.id, modifiedAt: candidate.modifiedAt, aesthetics: -1,
                utility: true, faceCount: 0, largestFaceShare: 0,
                analyzedAt: now(), error: IndexerError.missingAsset(candidate.id).localizedDescription
            )
            continue
        }
        guard let image = cgImage(for: asset, size: 640, allowNetwork: allowNetwork) else {
            cache[candidate.id] = RankRecord(
                id: candidate.id, modifiedAt: candidate.modifiedAt, aesthetics: -1,
                utility: true, faceCount: 0, largestFaceShare: 0,
                analyzedAt: now(), error: IndexerError.imageUnavailable(candidate.id).localizedDescription
            )
            continue
        }

        do {
            let aesthetics = try await CalculateImageAestheticsScoresRequest().perform(on: image)
            let faces = try await DetectFaceRectanglesRequest().perform(on: image)
            let largestFaceShare = faces.map { observation in
                Double(observation.boundingBox.cgRect.size.width * observation.boundingBox.cgRect.size.height)
            }.max() ?? 0
            cache[candidate.id] = RankRecord(
                id: candidate.id,
                modifiedAt: candidate.modifiedAt,
                aesthetics: aesthetics.overallScore,
                utility: aesthetics.isUtility,
                faceCount: faces.count,
                largestFaceShare: largestFaceShare,
                analyzedAt: now(),
                error: nil
            )
        } catch {
            cache[candidate.id] = RankRecord(
                id: candidate.id, modifiedAt: candidate.modifiedAt, aesthetics: -1,
                utility: true, faceCount: 0, largestFaceShare: 0,
                analyzedAt: now(), error: error.localizedDescription
            )
        }
    }
    fputs("\n", stderr)

    let wanted = Set(candidates.map(\.id))
    let records = cache.values.filter { wanted.contains($0.id) }.sorted { $0.id < $1.id }
    try writeJSON(records, to: output)
    print("Vision scores available for \(records.count) candidate photos.")
}

private func exportRepresentatives(input: String, directory: String) async throws {
    guard await requestPhotosAccess() else { throw IndexerError.denied }
    let requests = try readJSON([ExportRequest].self, from: input)
    let assets = fetchAssetMap(ids: requests.map(\.id))
    try writeImages(requests, assets: assets, directory: directory)
}

private func exportOriginals(input: String, directory: String) async throws {
    guard await requestPhotosAccess() else { throw IndexerError.denied }
    let requests = try readJSON([ExportRequest].self, from: input)
    let assets = fetchAssetMap(ids: requests.map(\.id))
    try writeOriginalImages(requests, assets: assets, directory: directory)
}

private func rematchSelections(selectionDirectory: String, candidatesPath: String, directory: String, reportPath: String) async throws {
    guard await requestPhotosAccess() else { throw IndexerError.denied }
    let fileManager = FileManager.default
    let selectionRoot = URL(fileURLWithPath: selectionDirectory, isDirectory: true)
    let favoriteRoot = selectionRoot.appendingPathComponent("favorites", isDirectory: true)
    let selectedFiles = ((try? fileManager.contentsOfDirectory(at: favoriteRoot, includingPropertiesForKeys: nil)) ?? [])
        .filter { ["jpg", "jpeg"].contains($0.pathExtension.lowercased()) }
        + ((try? fileManager.contentsOfDirectory(at: selectionRoot, includingPropertiesForKeys: nil)) ?? [])
        .filter { $0.lastPathComponent.range(of: #"^geonames-\d+\.jpe?g$"#, options: .regularExpression) != nil }
    let candidates = try readJSON([RankCandidate].self, from: candidatesPath)
    let candidatesByPlace = Dictionary(grouping: candidates, by: \.placeId)

    var wantedIds = Set(candidates.map(\.id))
    for url in selectedFiles where url.deletingLastPathComponent() == favoriteRoot {
        if let uuid = url.deletingPathExtension().lastPathComponent.split(separator: "-").suffix(5).joined(separator: "-").uppercased() as String? {
            wantedIds.insert(uuid + "/L0/001")
        }
    }
    let assets = fetchAssetMap(ids: Array(wantedIds))
    var assetPrints: [String: VNFeaturePrintObservation] = [:]
    var records: [SelectionMatchRecord] = []
    let outputRoot = URL(fileURLWithPath: directory, isDirectory: true)
    try fileManager.createDirectory(at: outputRoot, withIntermediateDirectories: true)

    for (index, sourceURL) in selectedFiles.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }).enumerated() {
        let selectedName = sourceURL.lastPathComponent
        var matchedAsset: PHAsset?
        var method = "uuid"
        var bestDistance: Float?
        var runnerUpDistance: Float?

        if sourceURL.deletingLastPathComponent() == favoriteRoot,
           let match = selectedName.range(of: #"[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12}"#, options: [.regularExpression, .caseInsensitive]) {
            let uuid = String(selectedName[match]).uppercased()
            matchedAsset = assets[uuid + "/L0/001"]
        } else {
            method = "vision-feature-print"
            let placeId = sourceURL.deletingPathExtension().lastPathComponent
            guard let sourceImage = sourceCGImage(at: sourceURL),
                  let sourcePrint = try? featurePrint(for: sourceImage) else {
                records.append(SelectionMatchRecord(selectedFilename: selectedName, photoId: nil, method: method, distance: nil, runnerUpDistance: nil, status: "source-unreadable", exportedFilename: nil))
                continue
            }
            let sourceRatio = Double(sourceImage.width) / Double(max(1, sourceImage.height))
            var scored: [(PHAsset, Float)] = []
            for candidate in candidatesByPlace[placeId] ?? [] {
                guard let asset = assets[candidate.id] else { continue }
                let assetRatio = Double(asset.pixelWidth) / Double(max(1, asset.pixelHeight))
                guard abs(log(sourceRatio / assetRatio)) < 0.035 else { continue }
                let printObservation: VNFeaturePrintObservation
                if let cached = assetPrints[candidate.id] {
                    printObservation = cached
                } else {
                    guard let image = cgImage(for: asset, size: 768, allowNetwork: true),
                          let generated = try? featurePrint(for: image) else { continue }
                    assetPrints[candidate.id] = generated
                    printObservation = generated
                }
                var distance: Float = 0
                try sourcePrint.computeDistance(&distance, to: printObservation)
                scored.append((asset, distance))
            }
            scored.sort { $0.1 < $1.1 }
            bestDistance = scored.first?.1
            runnerUpDistance = scored.dropFirst().first?.1
            if let best = scored.first,
               best.1 <= 0.20,
               runnerUpDistance == nil || runnerUpDistance! - best.1 >= 0.08 {
                matchedAsset = best.0
            }
        }

        guard let asset = matchedAsset else {
            records.append(SelectionMatchRecord(selectedFilename: selectedName, photoId: nil, method: method, distance: bestDistance, runnerUpDistance: runnerUpDistance, status: "unmatched-or-ambiguous", exportedFilename: nil))
            continue
        }
        guard let (data, ext) = currentImageData(for: asset, allowNetwork: true) else {
            records.append(SelectionMatchRecord(selectedFilename: selectedName, photoId: asset.localIdentifier, method: method, distance: bestDistance, runnerUpDistance: runnerUpDistance, status: "current-version-unavailable", exportedFilename: nil))
            continue
        }
        let outputName = sourceURL.deletingPathExtension().lastPathComponent + "." + ext
        try data.write(to: outputRoot.appendingPathComponent(outputName), options: .atomic)
        records.append(SelectionMatchRecord(selectedFilename: selectedName, photoId: asset.localIdentifier, method: method, distance: bestDistance, runnerUpDistance: runnerUpDistance, status: "exported-current", exportedFilename: outputName))
        print("Rematched \(index + 1)/\(selectedFiles.count): \(selectedName) -> \(outputName)")
    }
    try writeJSON(SelectionMatchReport(
        generatedAt: now(), selected: selectedFiles.count,
        matched: records.filter { $0.photoId != nil }.count,
        exported: records.filter { $0.status == "exported-current" }.count,
        records: records
    ), to: reportPath)
}

private func exportFavorites(directory: String, reportPath: String?) async throws {
    guard await requestPhotosAccess() else { throw IndexerError.denied }
    let options = PHFetchOptions()
    options.includeHiddenAssets = true
    options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
    let result = PHAsset.fetchAssets(with: .image, options: options)
    var requests: [ExportRequest] = []
    var assets: [String: PHAsset] = [:]
    var favoriteCount = 0

    result.enumerateObjects { asset, _, _ in
        guard asset.isFavorite else { return }
        favoriteCount += 1
        guard hasUsableLocation(asset) else { return }
        requests.append(ExportRequest(id: asset.localIdentifier, filename: favoriteFilename(for: asset)))
        assets[asset.localIdentifier] = asset
    }

    print("Found \(requests.count) Favorite images with GPS in Apple Photos; skipped \(favoriteCount - requests.count) without GPS.")
    let root = URL(fileURLWithPath: directory, isDirectory: true)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    var alreadyPresent = 0
    var exported = 0
    var failures: [FavoriteExportFailure] = []

    for (index, request) in requests.enumerated() {
        let destination = root.appendingPathComponent(request.filename)
        if FileManager.default.fileExists(atPath: destination.path) {
            alreadyPresent += 1
            continue
        }
        guard let asset = assets[request.id] else {
            failures.append(FavoriteExportFailure(filename: request.filename, reason: "Photo asset was not found."))
            continue
        }
        guard let image = cgImage(for: asset, size: 1920, allowNetwork: true) else {
            failures.append(FavoriteExportFailure(filename: request.filename, reason: "A preview could not be loaded."))
            continue
        }
        let bitmap = NSBitmapImageRep(cgImage: image)
        guard let data = bitmap.representation(using: .jpeg, properties: [.compressionFactor: 0.84]) else {
            failures.append(FavoriteExportFailure(filename: request.filename, reason: "JPEG encoding failed."))
            continue
        }
        do {
            try data.write(to: destination, options: .atomic)
            exported += 1
            print("Exported \(index + 1)/\(requests.count): \(request.filename)")
        } catch {
            failures.append(FavoriteExportFailure(filename: request.filename, reason: error.localizedDescription))
        }
    }

    let report = FavoriteExportReport(
        generatedAt: now(),
        requested: requests.count,
        alreadyPresent: alreadyPresent,
        exported: exported,
        failed: failures
    )
    if let reportPath { try writeJSON(report, to: reportPath) }
    print("Favorite export finished: \(alreadyPresent) already present, \(exported) exported, \(failures.count) failed.")
}

private func auditFavorites(output: String) async throws {
    guard await requestPhotosAccess() else { throw IndexerError.denied }
    let options = PHFetchOptions()
    options.includeHiddenAssets = true
    let assets = PHAsset.fetchAssets(with: options)
    var accessibleImages = 0
    var accessibleVideos = 0
    var favoriteImages = 0
    var favoriteImagesWithGPS = 0
    var hiddenFavoriteImages = 0
    var hiddenFavoriteImagesWithGPS = 0
    var favoriteVideos = 0
    var favoriteVideosWithGPS = 0
    var hiddenFavoriteVideos = 0
    var hiddenFavoriteVideosWithGPS = 0

    assets.enumerateObjects { asset, _, _ in
        switch asset.mediaType {
        case .image:
            accessibleImages += 1
            guard asset.isFavorite else { return }
            favoriteImages += 1
            if hasUsableLocation(asset) { favoriteImagesWithGPS += 1 }
            if asset.isHidden {
                hiddenFavoriteImages += 1
                if hasUsableLocation(asset) { hiddenFavoriteImagesWithGPS += 1 }
            }
        case .video:
            accessibleVideos += 1
            guard asset.isFavorite else { return }
            favoriteVideos += 1
            if hasUsableLocation(asset) { favoriteVideosWithGPS += 1 }
            if asset.isHidden {
                hiddenFavoriteVideos += 1
                if hasUsableLocation(asset) { hiddenFavoriteVideosWithGPS += 1 }
            }
        default:
            return
        }
    }

    try writeJSON(FavoriteAuditDocument(
        generatedAt: now(),
        authorizationStatus: authorizationStatusName(PHPhotoLibrary.authorizationStatus(for: .readWrite)),
        accessibleImages: accessibleImages,
        accessibleVideos: accessibleVideos,
        favoriteImages: favoriteImages,
        favoriteImagesWithGPS: favoriteImagesWithGPS,
        hiddenFavoriteImages: hiddenFavoriteImages,
        hiddenFavoriteImagesWithGPS: hiddenFavoriteImagesWithGPS,
        favoriteVideos: favoriteVideos,
        favoriteVideosWithGPS: favoriteVideosWithGPS,
        hiddenFavoriteVideos: hiddenFavoriteVideos,
        hiddenFavoriteVideosWithGPS: hiddenFavoriteVideosWithGPS
    ), to: output)
}

private func value(after flag: String, in arguments: [String]) -> String? {
    guard let index = arguments.firstIndex(of: flag), arguments.indices.contains(index + 1) else { return nil }
    return arguments[index + 1]
}

@main
struct TravelPhotoIndexer {
    static func main() async {
        let arguments = Array(CommandLine.arguments.dropFirst())
        do {
            guard let command = arguments.first else {
                throw IndexerError.usage("Usage: TravelPhotoIndexer scan|rank|export|export-originals [options]")
            }
            switch command {
            case "scan":
                guard let output = value(after: "--output", in: arguments) else {
                    throw IndexerError.usage("scan requires --output PATH")
                }
                try await scan(output: output)
            case "rank":
                guard let input = value(after: "--input", in: arguments),
                      let output = value(after: "--output", in: arguments) else {
                    throw IndexerError.usage("rank requires --input PATH --output PATH")
                }
                try await rank(input: input, output: output, allowNetwork: arguments.contains("--download-missing"))
            case "export":
                guard let input = value(after: "--input", in: arguments),
                      let directory = value(after: "--directory", in: arguments) else {
                    throw IndexerError.usage("export requires --input PATH --directory PATH")
                }
                try await exportRepresentatives(input: input, directory: directory)
            case "export-originals":
                guard let input = value(after: "--input", in: arguments),
                      let directory = value(after: "--directory", in: arguments) else {
                    throw IndexerError.usage("export-originals requires --input PATH --directory PATH")
                }
                try await exportOriginals(input: input, directory: directory)
            case "favorites":
                guard let directory = value(after: "--directory", in: arguments) else {
                    throw IndexerError.usage("favorites requires --directory PATH")
                }
                try await exportFavorites(
                    directory: directory,
                    reportPath: value(after: "--report", in: arguments)
                )
            case "favorites-audit":
                guard let output = value(after: "--output", in: arguments) else {
                    throw IndexerError.usage("favorites-audit requires --output PATH")
                }
                try await auditFavorites(output: output)
            case "rematch-selections":
                guard let selectionDirectory = value(after: "--selection-directory", in: arguments),
                      let candidates = value(after: "--candidates", in: arguments),
                      let directory = value(after: "--directory", in: arguments),
                      let report = value(after: "--report", in: arguments) else {
                    throw IndexerError.usage("rematch-selections requires --selection-directory PATH --candidates PATH --directory PATH --report PATH")
                }
                try await rematchSelections(selectionDirectory: selectionDirectory, candidatesPath: candidates, directory: directory, reportPath: report)
            default:
                throw IndexerError.usage("Unknown command: \(command)")
            }
        } catch {
            fputs("TravelPhotoIndexer: \(error.localizedDescription)\n", stderr)
            Foundation.exit(1)
        }
    }
}
