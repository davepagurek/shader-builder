import { ShaderAttribute, ShaderGraph, ShaderSnippet, ShaderUniform, ShaderVarying } from '../src/shader-builder'

const graph = new ShaderGraph({ version: 300 })

const p5Inputs = {
  position: new ShaderAttribute('vec3', 'aPosition'),
  texCoord: new ShaderAttribute('vec2', 'aTexCoord'),
  vertexColor: new ShaderAttribute('vec4', 'aVertexColor'),
  mvMatrix: new ShaderUniform('mat4', 'uModelViewMatrix'),
  projMatrix: new ShaderUniform('mat4', 'uProjectionMatrix'),
}

const ApplyCamera = new ShaderSnippet(`
  vec4 applyCamera(mat4 mvMatrix, mat4 projMatrix, vec3 worldPos) {
    return mvMatrix * projMatrix * worldPos;
  }
`)
const applyCamera = ApplyCamera.instantiate()
p5Inputs.position.connectTo(applyCamera.inputs.worldPos)
p5Inputs.mvMatrix.connectTo(applyCamera.inputs.mvMatrix)
p5Inputs.projMatrix.connectTo(applyCamera.inputs.projMatrix)
applyCamera.connectTo(graph.position)

p5Inputs.vertexColor.connectTo(graph.color)

const { vert, frag } = graph.build()
console.log(vert)
console.log(frag)
