import { ShaderAttribute, ShaderGraph, ShaderSnippet, ShaderUniform, ShaderVarying } from '../src/shader-builder'

function defaultShader(version: 100 | 300 = 100) {
  const graph = new ShaderGraph({ version })

  const inputs = {
    position: new ShaderAttribute('vec3', 'aPosition'),
    texCoord: new ShaderAttribute('vec2', 'aTexCoord'),
    vertexColor: new ShaderAttribute('vec4', 'aVertexColor'),
    mvMatrix: new ShaderUniform('mat4', 'uModelViewMatrix'),
    projMatrix: new ShaderUniform('mat4', 'uProjectionMatrix'),
    texture: new ShaderUniform('sampler2D', 'uTexture'),
  }

  const ApplyCamera = new ShaderSnippet(`
    vec4 applyCamera(mat4 mvMatrix, mat4 projMatrix, vec3 worldPos) {
      return mvMatrix * projMatrix * worldPos;
    }
  `)
  const applyCamera = ApplyCamera.instantiate()
  inputs.position.connectTo(applyCamera.inputs.worldPos)
  inputs.mvMatrix.connectTo(applyCamera.inputs.mvMatrix)
  inputs.projMatrix.connectTo(applyCamera.inputs.projMatrix)
  applyCamera.connectTo(graph.position)

  inputs.vertexColor.connectTo(graph.color)

  return { inputs, graph }
}

const { graph } = defaultShader()
graph.color.input.replaceWith(new ShaderSnippet(`vec4 makeColor() { return vec4(1., 0., 0., 1.); }`).instantiate())

const { vert, frag } = graph.build()
console.log(vert)
console.log(frag)
