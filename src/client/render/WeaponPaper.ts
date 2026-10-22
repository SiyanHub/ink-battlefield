import * as T from "three";
/** Screen-space graphite for the close-up model, without allocating another post-process target. */
export function applyWeaponPaper(model:T.Object3D) {
  model.traverse(node=>{
    if(node instanceof T.LineSegments&&node.material instanceof T.LineBasicMaterial){
      node.material.opacity=.48;node.material.color.setHex(0x514d45);
    }
    if(!(node instanceof T.Mesh)||!(node.material instanceof T.MeshLambertMaterial))return;
    node.material.onBeforeCompile=shader=>{
      shader.fragmentShader=shader.fragmentShader.replace("#include <opaque_fragment>",`
        float paperLum = clamp(dot(outgoingLight, vec3(.2126,.7152,.0722)), 0.0, 1.0);
        float strokePhase = (gl_FragCoord.x+gl_FragCoord.y)/6.4 + sin(gl_FragCoord.y*.065)*.055;
        float graphiteStroke = 1.0 - smoothstep(.045,.15,abs(fract(strokePhase)-.5));
        float crossStroke = 1.0 - smoothstep(.035,.13,abs(fract((gl_FragCoord.x-gl_FragCoord.y)/7.8)-.5));
        float graphiteShade = 1.0-paperLum;
        vec3 materialTint = diffuse / max(.10, max(diffuse.r, max(diffuse.g, diffuse.b)));
        // A graphite grip must remain darker than ivory paper. Normalising the
        // old light result flattened every material into the same middle gray.
        float paperValue = .12 + .86 * pow(paperLum,.84);
        vec3 paperLight = mix(vec3(.96,.928,.865), materialTint, .30)*paperValue;
        float pencil = graphiteStroke*(.055+graphiteShade*.19) + crossStroke*smoothstep(.35,.8,graphiteShade)*.13;
        float fibre = fract(sin(dot(floor(gl_FragCoord.xy),vec2(12.9898,78.233)))*43758.5453)-.5;
        paperLight *= 1.0-pencil;
        paperLight += fibre*.012;
        outgoingLight = paperLight;
        #include <opaque_fragment>
      `);
    };
    node.material.customProgramCacheKey=()=>"weapon-paper-v4";
  });
}
