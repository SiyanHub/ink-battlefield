import * as T from "three";
/** Screen-space graphite for the close-up model, without allocating another post-process target. */
export function applyWeaponPaper(model:T.Object3D) {
  model.traverse(node=>{
    if(!(node instanceof T.Mesh)||!(node.material instanceof T.MeshLambertMaterial))return;
    node.material.onBeforeCompile=shader=>{
      shader.fragmentShader=shader.fragmentShader.replace("#include <opaque_fragment>",`
        float paperLum = clamp(dot(outgoingLight, vec3(.2126,.7152,.0722)), 0.0, 1.0);
        float graphiteStroke = 1.0 - smoothstep(.035,.11,abs(fract((gl_FragCoord.x+gl_FragCoord.y)/6.0)-.5));
        float graphiteShade = 1.0-paperLum;
        vec3 materialTint = diffuse / max(.10, max(diffuse.r, max(diffuse.g, diffuse.b)));
        // A graphite grip must remain darker than ivory paper. Normalising the
        // old light result flattened every material into the same middle gray.
        float paperValue = .16 + .82 * pow(paperLum,.68);
        vec3 paperLight = mix(vec3(.96,.928,.865), materialTint, .30)*paperValue;
        paperLight *= 1.0-graphiteStroke*graphiteShade*.13;
        outgoingLight = paperLight;
        #include <opaque_fragment>
      `);
    };
    node.material.customProgramCacheKey=()=>"weapon-paper-v3";
  });
}
