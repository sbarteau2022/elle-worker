// ============================================================
// vision_emit.swift - Apple Vision -> CSV time series for the bimodal rip.
//
// Emits one row per frame: frame,t,yaw,pitch,roll,flow_mag
//   yaw/pitch/roll  = head pose (radians)         -> the SLOW / structural mode
//   flow_mag        = mean optical-flow magnitude -> the FAST / dynamic mode
//
// OFFLINE FIRST: run it on a recorded clip, not the live camera - reproducible,
// and no live-camera privacy surface for the first experiment.
//   swiftc -O vision_emit.swift -o vision_emit
//   ./vision_emit clip.mov > vision.csv
//   python3 rip.py --csv vision.csv --col flow_mag --fps 30
//
// SCAFFOLD: not compiled/tested off-Mac. The CSV contract is the fixed part;
// adjust API details (revisions, pixel formats) on macOS. Vision runs on the
// Neural Engine, so it is light on 8GB.
// ============================================================
import AVFoundation
import Vision
import CoreVideo

guard CommandLine.arguments.count > 1 else { FileHandle.standardError.write("usage: vision_emit <video>\n".data(using:.utf8)!); exit(1) }
let url = URL(fileURLWithPath: CommandLine.arguments[1])
let asset = AVAsset(url: url)
guard let track = asset.tracks(withMediaType: .video).first,
      let reader = try? AVAssetReader(asset: asset) else { exit(1) }
let out = AVAssetReaderTrackOutput(track: track, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
reader.add(out); reader.startReading()
let fps = track.nominalFrameRate > 0 ? track.nominalFrameRate : 30.0

func meanFlowMagnitude(_ pb: CVPixelBuffer) -> Double {
    CVPixelBufferLockBaseAddress(pb, .readOnly); defer { CVPixelBufferUnlockBaseAddress(pb, .readOnly) }
    let w = CVPixelBufferGetWidth(pb), h = CVPixelBufferGetHeight(pb)
    guard let base = CVPixelBufferGetBaseAddress(pb) else { return 0 }
    let stride = CVPixelBufferGetBytesPerRow(pb) / MemoryLayout<Float>.size
    let p = base.assumingMemoryBound(to: Float.self)
    var sum = 0.0; var n = 0
    for y in Swift.stride(from: 0, to: h, by: 4) {
        for x in Swift.stride(from: 0, to: w*2, by: 8) {
            let dx = Double(p[y*stride + x]); let dy = Double(p[y*stride + x + 1])
            sum += (dx*dx + dy*dy).squareRoot(); n += 1
        }
    }
    return n > 0 ? sum/Double(n) : 0
}

print("frame,t,yaw,pitch,roll,flow_mag")
var prev: CVPixelBuffer? = nil
var i = 0
let faceReq = VNDetectFaceLandmarksRequest()
if #available(macOS 12.0, *) { faceReq.revision = VNDetectFaceLandmarksRequestRevision3 }

while reader.status == .reading, let sb = out.copyNextSampleBuffer(), let pb = CMSampleBufferGetImageBuffer(sb) {
    let t = Double(i) / Double(fps)
    var yaw = "", pitch = "", roll = ""
    let h = VNImageRequestHandler(cvPixelBuffer: pb, orientation: .up)
    try? h.perform([faceReq])
    if let f = (faceReq.results as? [VNFaceObservation])?.first {
        if let y = f.yaw   { yaw   = String(format:"%.5f", y.doubleValue) }
        if let p = f.pitch { pitch = String(format:"%.5f", p.doubleValue) }
        if let r = f.roll  { roll  = String(format:"%.5f", r.doubleValue) }
    }
    var flow = 0.0
    if let prev = prev {
        let req = VNGenerateOpticalFlowRequest(targetedCVPixelBuffer: pb, options: [:])
        let fh = VNImageRequestHandler(cvPixelBuffer: prev, orientation: .up)
        try? fh.perform([req])
        if let obs = req.results?.first as? VNPixelBufferObservation { flow = meanFlowMagnitude(obs.pixelBuffer) }
    }
    print("\(i),\(String(format:"%.4f",t)),\(yaw),\(pitch),\(roll),\(String(format:"%.5f",flow))")
    prev = pb; i += 1
}
