// Loads MediaPipe's pose model in the browser and runs it on video frames.
// Everything runs on the device: no video leaves the browser.

const VERSION = "0.10.14";
const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}`;
const MODEL = (size) => `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${size}/float16/1/pose_landmarker_${size}.task`;

export function isPhone() {
  return /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || matchMedia("(pointer: coarse)").matches;
}

// "auto": the most accurate model on a laptop, the balanced one on a phone.
export function resolveModel(choice) {
  if (choice && choice !== "auto") return choice;
  return isPhone() ? "full" : "heavy";
}

export async function createPose(modelChoice = "auto", onStatus = () => {}) {
  const size = resolveModel(modelChoice);
  onStatus(`Loading pose model (${size})…`);
  const { FilesetResolver, PoseLandmarker } = await import(`${CDN}/vision_bundle.mjs`);
  const fileset = await FilesetResolver.forVisionTasks(`${CDN}/wasm`);
  const opts = (delegate) => ({
    baseOptions: { modelAssetPath: MODEL(size), delegate },
    runningMode: "VIDEO",
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  let landmarker, delegate = "GPU";
  try {
    landmarker = await PoseLandmarker.createFromOptions(fileset, opts("GPU"));
  } catch (e) {
    delegate = "CPU";
    landmarker = await PoseLandmarker.createFromOptions(fileset, opts("CPU"));
  }
  onStatus(`Pose model ready (${size}, ${delegate})`);
  let lastTs = 0;
  return {
    size, delegate,
    detect(video, ts) {
      const t = Math.max(ts, lastTs + 1); // timestamps must strictly increase
      lastTs = t;
      const r = landmarker.detectForVideo(video, t);
      return r.landmarks && r.landmarks[0] ? r.landmarks[0] : null;
    },
    close() { try { landmarker.close(); } catch { /* already closed */ } },
  };
}
