// Camera barcode scanner. Uses the browser's BarcodeDetector where it exists
// (Chrome on Android/macOS); otherwise the bundled ZXing library (iPhone Safari).
// Only accepts codes whose GTIN check digit is valid, to avoid misreads.
// Resolves with the barcode string, or null if cancelled.
import { validateBarcode } from './ean.js';

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
let zxingPromise;

function loadZxing() {
  if (window.ZXing) return Promise.resolve(window.ZXing);
  if (!zxingPromise) {
    zxingPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'vendor/zxing.min.js';
      s.onload = () => resolve(window.ZXing);
      s.onerror = () => { zxingPromise = null; reject(new Error('Could not load the scanner library.')); };
      document.head.append(s);
    });
  }
  return zxingPromise;
}

async function makeDetector() {
  if ('BarcodeDetector' in window) {
    try {
      const supported = await window.BarcodeDetector.getSupportedFormats();
      const formats = FORMATS.filter((f) => supported.includes(f));
      if (formats.length) {
        const d = new window.BarcodeDetector({ formats });
        return { name: 'native', detect: async (video) => (await d.detect(video)).map((b) => b.rawValue) };
      }
    } catch { /* fall through to ZXing */ }
  }
  const ZXing = await loadZxing();
  const hints = new Map();
  hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
    ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.EAN_8, ZXing.BarcodeFormat.UPC_A, ZXing.BarcodeFormat.UPC_E,
  ]);
  hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
  const reader = new ZXing.MultiFormatReader();
  reader.setHints(hints);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return {
    name: 'zxing',
    detect: async (video) => {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) return [];
      // Decode the central band only: faster, and where the guide box is.
      const bandH = Math.round(h * 0.5);
      canvas.width = w;
      canvas.height = bandH;
      ctx.drawImage(video, 0, Math.round((h - bandH) / 2), w, bandH, 0, 0, w, bandH);
      try {
        const source = new ZXing.HTMLCanvasElementLuminanceSource(canvas);
        const bitmap = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(source));
        return [reader.decode(bitmap).getText()];
      } catch {
        return []; // NotFoundException etc. = nothing in this frame
      } finally {
        reader.reset();
      }
    },
  };
}

export function openScanner() {
  return new Promise((resolve) => {
    const overlay = document.getElementById('tpl-scanner').content.firstElementChild.cloneNode(true);
    document.body.append(overlay);
    const video = overlay.querySelector('video');
    const status = overlay.querySelector('[data-scan-status]');
    const manual = overlay.querySelector('input[name="manualEan"]');
    let stream = null;
    let stopped = false;
    let timer = null;

    const finish = (value) => {
      if (stopped) return;
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
      overlay.remove();
      resolve(value);
    };

    overlay.querySelector('[data-action="cancel-scan"]').addEventListener('click', () => finish(null));
    overlay.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = validateBarcode(manual.value);
      if (!v.code) return;
      finish(v.code);
    });
    overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') finish(null); });

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        status.textContent = 'This browser can\'t use the camera. Type the barcode below.';
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
      } catch (err) {
        status.textContent = err.name === 'NotAllowedError'
          ? 'Camera permission was refused. Allow it in Settings > Safari > Camera, or type the barcode below.'
          : `Couldn't start the camera (${err.message}). Type the barcode below.`;
        return;
      }
      if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
      video.srcObject = stream;
      await video.play().catch(() => {});
      let detector;
      try { detector = await makeDetector(); } catch (err) {
        status.textContent = `${err.message} Type the barcode below.`;
        return;
      }
      status.textContent = 'Point the camera at the barcode.';
      overlay.dataset.engine = detector.name;
      const tick = async () => {
        if (stopped) return;
        const codes = await detector.detect(video).catch(() => []);
        const good = codes.map((c) => validateBarcode(c)).find((v) => v.ok && v.code);
        if (good) {
          navigator.vibrate?.(60);
          finish(good.code);
          return;
        }
        timer = setTimeout(tick, 120);
      };
      tick();
    })();
  });
}
