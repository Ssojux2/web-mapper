// Built-in "Test Card" media, drawn once per window. Numbered colored corners make it
// obvious which way round a surface is mapped.

let cached: HTMLCanvasElement | null = null;

export function getTestcard(): HTMLCanvasElement {
  if (cached) return cached;
  const w = 1920;
  const h = 1080;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, '#20263a');
  bg.addColorStop(1, '#3a2040');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 2;
  for (let x = 0; x <= w; x += 120) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y <= h; y += 120) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, w - 6, h - 6);
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, h * 0.42, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(w, h);
  ctx.moveTo(w, 0);
  ctx.lineTo(0, h);
  ctx.lineWidth = 2;
  ctx.stroke();

  const bars = ['#ffffff', '#ffff00', '#00ffff', '#00ff00', '#ff00ff', '#ff0000', '#0000ff', '#000000'];
  const bw = 600 / bars.length;
  bars.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(w / 2 - 300 + i * bw, h / 2 + 150, bw, 80);
  });

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 120px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('TEST CARD', w / 2, h / 2 - 40);

  const corners: [number, number, string, string][] = [
    [0, 0, '#ef3b3b', '1'],
    [w, 0, '#35d24f', '2'],
    [w, h, '#3f72ff', '3'],
    [0, h, '#ffd726', '4'],
  ];
  const s = 180;
  ctx.font = 'bold 80px system-ui, sans-serif';
  for (const [x, y, color, label] of corners) {
    const dx = x === 0 ? 1 : -1;
    const dy = y === 0 ? 1 : -1;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + dx * s, y);
    ctx.lineTo(x, y + dy * s);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#000000';
    ctx.fillText(label, x + dx * 50, y + dy * 55);
  }

  cached = canvas;
  return canvas;
}
