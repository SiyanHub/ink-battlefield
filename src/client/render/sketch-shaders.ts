// Adapted from the user-owned Opus5.5/src/sketch.js. See docs/SOURCES.md.
export const sketchVertex = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export const sketchFragment = /* glsl */`
  precision highp float;

  varying vec2 vUv;

  uniform sampler2D tScene;
  uniform sampler2D tNormal;
  uniform sampler2D tDepth;
  uniform sampler2D tPaper;
  uniform sampler2D tHatch;

  uniform vec2  uResolution;
  uniform float uNear;
  uniform float uFar;
  uniform float uTime;
  uniform float uBoil;         // how far the lines wander (uv units)
  uniform float uBoilRate;     // steps per second the wobble holds for
  uniform float uPaperScale;
  uniform float uHatchScale;   // on-screen size of one hatch tile, in tiles per 512px
  uniform float uEdgeDepth;    // silhouette strength
  uniform float uEdgeNormal;   // crease strength
  uniform float uEdgeFade;     // distance at which outlines have faded out
  uniform float uTone;         // graphite darkness
  uniform float uInkMin;       // chroma where ink starts surviving
  uniform float uInkMax;       // chroma where ink is fully untouched
  uniform float uEnabled;
  uniform vec3  uPaperTint;

  // 1 / view distance. For any flat surface this is linear in screen space, so
  // its second difference is zero on a plane no matter how steeply it is seen.
  // Only real silhouettes survive — no more floors drowning in outline.
  float invDepth(vec2 uv) {
    float d = texture2D(tDepth, uv).x;
    return (uFar - (uFar - uNear) * d) / (uNear * uFar);
  }

  vec3 normalAt(vec2 uv) {
    return texture2D(tNormal, uv).xyz * 2.0 - 1.0;
  }

  // Hand-drawn wobble: a low-frequency offset that snaps to a low frame rate,
  // so lines shiver like animated pencil rather than shimmering every frame.
  vec2 boilOffset(vec2 uv, float t) {
    float step = floor(t * uBoilRate);
    float a = sin(uv.y * 31.7 + step * 1.7) * cos(uv.x * 27.3 - step * 2.1);
    float b = sin(uv.x * 23.1 - step * 1.3) * cos(uv.y * 35.9 + step * 2.7);
    return vec2(a, b) * uBoil;
  }

  float edgeMask(vec2 uv, float px, float py, out float dist) {
    float i0 = invDepth(uv);
    float iL = invDepth(uv - vec2(px, 0.0));
    float iR = invDepth(uv + vec2(px, 0.0));
    float iB = invDepth(uv - vec2(0.0, py));
    float iT = invDepth(uv + vec2(0.0, py));
    dist = 1.0 / max(i0, 1e-6);

    // Relative second difference: scale-free, so a near crate and a far wall
    // get the same line weight.
    float lap = max(abs(iL + iR - 2.0 * i0), abs(iB + iT - 2.0 * i0));
    float depthE = smoothstep(0.015, 0.06, lap / max(i0, 1e-6));

    vec3 nL = normalAt(uv - vec2(px, 0.0));
    vec3 nR = normalAt(uv + vec2(px, 0.0));
    vec3 nB = normalAt(uv - vec2(0.0, py));
    vec3 nT = normalAt(uv + vec2(0.0, py));
    float nDiff = max(length(nR - nL), length(nT - nB));
    float normalE = smoothstep(0.22, 0.5, nDiff);

    return max(depthE * uEdgeDepth, normalE * uEdgeNormal);
  }

  // R holds +45 degree strokes, G holds -45 degree strokes.
  vec4 hatchAt(vec2 pix, float rot, float scale) {
    float c = cos(rot), s = sin(rot);
    vec2 p = vec2(pix.x * c - pix.y * s, pix.x * s + pix.y * c);
    return texture2D(tHatch, p / (512.0 * scale));
  }

  void main() {
    vec3 linearCol = texture2D(tScene, vUv).rgb;
    vec3 sceneCol = mix(linearCol * 12.92, 1.055 * pow(max(linearCol, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), linearCol));

    if (uEnabled < 0.5) {
      gl_FragColor = vec4(sceneCol, 1.0);
      return;
    }

    float px = 1.0 / uResolution.x;
    float py = 1.0 / uResolution.y;

    // ---- chroma test: is this pixel ink or graphite? ----
    float mx = max(sceneCol.r, max(sceneCol.g, sceneCol.b));
    float mn = min(sceneCol.r, min(sceneCol.g, sceneCol.b));
    float chroma = mx > 0.0001 ? (mx - mn) / mx : 0.0;
    float ink = smoothstep(uInkMin, uInkMax, chroma);

    // ---- wobble the sampling grid so the drawing boils ----
    vec2 wuv = vUv + boilOffset(vUv, uTime);

    // ---- outline ----
    float dist;
    float edge = edgeMask(mix(vUv, wuv, 0.65), px, py, dist);
    // Preserve printed pencil marks and faces, which have no normal/depth edge.
    // Only the darker side of a local contrast contributes, avoiding bright halos.
    vec3 weights = vec3(.2126,.7152,.0722);
    float sourceLum = dot(linearCol, weights);
    float neighbour = max(max(dot(texture2D(tScene,vUv+vec2(px,0.0)).rgb,weights),
      dot(texture2D(tScene,vUv-vec2(px,0.0)).rgb,weights)),
      max(dot(texture2D(tScene,vUv+vec2(0.0,py)).rgb,weights),
      dot(texture2D(tScene,vUv-vec2(0.0,py)).rgb,weights)));
    edge = max(edge,smoothstep(.008,.07,neighbour-sourceLum)*.75*(1.0-ink));
    edge *= 1.0 - smoothstep(uEdgeFade * 0.45, uEdgeFade, dist);

    // ---- luminance -> hatch density ----
    float lum = dot(sceneCol, vec3(0.2126, 0.7152, 0.0722));
    float shade = clamp(1.0 - lum, 0.0, 1.0);

    // Hatch in screen pixels, wobbling with the lines. Three layers that come
    // in one after another as the tone deepens: one diagonal, the crossing
    // diagonal, then a denser, slightly turned set for the darkest shadow.
    vec2 pix = mix(vUv, wuv, 0.5) * uResolution;
    vec4 h1 = hatchAt(pix, 0.0, uHatchScale);
    vec4 h2 = hatchAt(pix + 37.0, 0.26, uHatchScale * 0.8);
    float grain = texture2D(tPaper, vec2(vUv.x, 1.0 - vUv.y) * 2.3).r;
    float bristle = 0.75 + grain * 0.4;

    float mask = 0.0;
    mask += h1.r * smoothstep(0.28, 0.58, shade);
    mask += h1.g * smoothstep(0.52, 0.78, shade);
    mask += h2.r * smoothstep(0.58, 0.82, shade);
    mask = clamp(mask * bristle, 0.0, 1.0);

    // Flat graphite wash under the hatching keeps deep shadow solid.
    float wash = shade * .10 + smoothstep(0.48, 1.0, shade) * 0.28;
    float tone = clamp(mask * uTone * 0.7 + wash, 0.0, 1.0);

    // ---- paper ----
    vec3 paper = texture2D(tPaper, vUv * uPaperScale).rgb * uPaperTint;
    // A gentle sideways falloff, like a page lit from the left.
    paper *= 1.0 - smoothstep(0.55, 1.15, vUv.x) * 0.06;

    vec3 graphite = paper * (1.0 - tone);
    graphite = mix(graphite, vec3(0.16, 0.15, 0.14), edge * 0.9);

    // ---- ink survives untouched ----
    vec3 inkCol = sceneCol;
    // A whisper of paper texture on top so ink sits *in* the page.
    inkCol *= (0.93 + grain * 0.14);
    // Ink also gets a darker contour where it meets graphite (bleed edge).
    inkCol = mix(inkCol, inkCol * 0.5, edge * 0.6);

    vec3 col = mix(graphite, inkCol, ink);

    // ---- page vignette: paper darkens right at the screen rim ----
    vec2 q = vUv - 0.5;
    col *= 1.0 - dot(q, q) * 0.3;

    gl_FragColor = vec4(col, 1.0);
  }
`;
