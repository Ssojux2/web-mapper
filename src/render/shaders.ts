// Surface vertices arrive as homogeneous output positions (x·w, y·w, w), built on the
// CPU from the corner-pin homography plus any mesh-warp offset. Passing w through to
// gl_Position makes the GPU interpolate the unit-square coordinate perspective-correctly
// (no seam along triangle diagonals). The input-side homography is applied per
// fragment, which keeps a trapezoid input region correct as well.

export const surfaceVert = `#version 300 es
in vec3 a_pos;
in vec2 a_st;
uniform mat3 u_clip;
out vec2 v_st;
void main() {
  vec3 p = u_clip * a_pos;
  v_st = a_st;
  gl_Position = vec4(p.xy, 0.0, p.z);
}
`;

export const surfaceFrag = `#version 300 es
precision highp float;
in vec2 v_st;
uniform mat3 u_input;
uniform sampler2D u_tex;
uniform sampler2D u_mask;   // coverage in alpha, covering the whole output frame
uniform vec2 u_canvas;      // canvas size in pixels
uniform float u_opacity;
out vec4 outColor;
void main() {
  vec3 q = u_input * vec3(v_st, 1.0);
  vec2 uv = q.xy / q.z;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;
  float mask = texture(u_mask, vec2(gl_FragCoord.x / u_canvas.x, 1.0 - gl_FragCoord.y / u_canvas.y)).a;
  // Textures are uploaded premultiplied, so opacity and mask scale all four channels.
  outColor = texture(u_tex, uv) * (u_opacity * mask);
}
`;

export const fullscreenVert = `#version 300 es
in vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

// Alignment grid drawn in output pixels: border, square grid from the center,
// center cross, inscribed circle and colored corner markers (1 red, 2 green, 3 blue, 4 yellow).
export const testPatternFrag = `#version 300 es
precision highp float;
uniform vec2 u_res;     // output size in pixels
uniform float u_scale;  // canvas pixels per output pixel
out vec4 outColor;

float line(float d, float w) { return 1.0 - smoothstep(w * 0.5, w * 0.5 + 1.0 / u_scale, abs(d)); }

void main() {
  vec2 p = vec2(gl_FragCoord.x, u_res.y * u_scale - gl_FragCoord.y) / u_scale;
  float w = max(2.0, 1.25 / u_scale);
  vec3 col = vec3(0.07);

  float cell = u_res.y / 8.0;
  vec2 c = p - u_res * 0.5;
  vec2 g = mod(c + cell * 0.5, cell) - cell * 0.5;
  float grid = max(line(g.x, w * 0.6), line(g.y, w * 0.6));
  col = mix(col, vec3(0.45), grid);

  vec2 g2 = mod(c + cell * 0.25, cell * 0.5) - cell * 0.25;
  col = mix(col, vec3(0.22), max(line(g2.x, w * 0.4), line(g2.y, w * 0.4)) * (1.0 - grid));

  float cross = max(line(c.x, w * 1.5), line(c.y, w * 1.5));
  col = mix(col, vec3(1.0), cross);

  float r = length(c);
  col = mix(col, vec3(1.0), line(r - u_res.y * 0.45, w * 1.5));
  col = mix(col, vec3(1.0), line(r - u_res.y * 0.1, w));

  float border = min(min(p.x, u_res.x - p.x), min(p.y, u_res.y - p.y));
  col = mix(col, vec3(1.0), 1.0 - smoothstep(w * 2.0, w * 2.0 + 1.0 / u_scale, border));

  float m = u_res.y * 0.08;
  if (p.x < m && p.y < m && p.x + p.y < m) col = vec3(0.95, 0.2, 0.2);
  if (p.x > u_res.x - m && p.y < m && (u_res.x - p.x) + p.y < m) col = vec3(0.2, 0.85, 0.3);
  if (p.x > u_res.x - m && p.y > u_res.y - m && (u_res.x - p.x) + (u_res.y - p.y) < m) col = vec3(0.25, 0.45, 1.0);
  if (p.x < m && p.y > u_res.y - m && p.x + (u_res.y - p.y) < m) col = vec3(1.0, 0.85, 0.15);

  outColor = vec4(col, 1.0);
}
`;
