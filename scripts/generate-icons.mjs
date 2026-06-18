// One-shot script: generates PWA icons with dark background + lavender "W".
// Run once: node scripts/generate-icons.mjs
// Requires: npm install --save-dev canvas (can be removed after running)
import { createCanvas } from "canvas";
import { writeFileSync, mkdirSync } from "fs";

const BG      = "#0b0d11";   // matches manifest background_color + page bg
const LAVENDER = "#b39ddb";  // matches PurpleAir temp lavender in the UI

function generate(size) {
  const canvas = createCanvas(size, size);
  const ctx    = canvas.getContext("2d");

  // Background
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, size, size);

  // Rounded-rect clip (iOS masks to a squircle, but a clip keeps edges clean
  // under Android's circle mask and macOS Safari's rounded rect).
  const r = size * 0.18;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(size - r, 0);
  ctx.quadraticCurveTo(size, 0, size, r);
  ctx.lineTo(size, size - r);
  ctx.quadraticCurveTo(size, size, size - r, size);
  ctx.lineTo(r, size);
  ctx.quadraticCurveTo(0, size, 0, size - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
  ctx.fillStyle = BG;
  ctx.fill();

  // "W" glyph — centered, fills ~60% of the icon height
  const fontSize = Math.round(size * 0.62);
  ctx.font       = `bold ${fontSize}px sans-serif`;
  ctx.fillStyle  = LAVENDER;
  ctx.textAlign  = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("W", size / 2, size / 2);

  return canvas.toBuffer("image/png");
}

mkdirSync("public/icons", { recursive: true });

for (const size of [192, 512]) {
  const buf = generate(size);
  writeFileSync(`public/icons/icon-${size}.png`, buf);
  console.log(`wrote public/icons/icon-${size}.png (${size}×${size})`);
}

// Apple touch icon: 180×180
const appleBuf = generate(180);
writeFileSync("public/icons/apple-touch-icon.png", appleBuf);
console.log("wrote public/icons/apple-touch-icon.png (180×180)");
