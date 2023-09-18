# shader-builder
A shader graph library to enable p5 shader plugins

## What's this for?

p5 has a lively community, including many libraries. However, it is currently difficult to make WebGL libraries, as there is no easy way to extend p5's shader system without copy-and-pasting the existing shaders from p5's source code. This requires a deep understanding of p5, and can cause plugins to go out of date when p5 implementations change.

This library is a proof of concept to see if there is a way p5 can provide a shader API that libraries can build off of.

## How will it work?

### The snippet graph

Shaders are broken down into a graph of **snippets**, where each one is a function:

```js
const ApplyCamera = new ShaderSnippet(`
  vec4 applyCamera(mat4 mvMatrix, mat4 projMatrix, vec3 worldPos) {
    return mvMatrix * projMatrix * worldPos;
  }
`)
```

You can connect snippets together to the different inputs and outputs of a shader:

```js
const applyCamera = ApplyCamera.instantiate()
myPositionInput.connectTo(applyCamera.inputs.worldPos)
myMVMatrixInput.connectTo(applyCamera.inputs.mvMatrix)
myProjMatrixInput.connectTo(applyCamera.inputs.projMatrix)
applyCamera.connectTo(shader.position)
```

When you've connected something to `shader.position` and `shader.color`, you can output full shader source code:

```js
const { vert, frag } = shader.build()
```

### Replacing default functionality

The idea is to make a shader system where you can easily replace parts. If a default graph is provided, you can rewire pieces, such as by replacing the logic for the pixel color:

```js
const MakeColor = new ShaderSnippet(`vec4 makeColor() { return vec4(1., 0., 0., 1.); }`)
shader.color.input.replaceWith(MakeColor.instantiate())
```

In addition to standard shader outputs (`position` and `color`), the default shader can also expose and document intermediate values. For example, instead of fully replacing the screen position, one could instead replace the input to the camera transform:
```js
shader.cameraTransform.inputs.worldPos.input.replaceWith(something)
```

### Backwards compatibility

We ideally want to support both WebGL 2 (GLSL ES 300) and WebGL 1. This often means providing slightly different implementations, sometimes using extensions. Snippets can handle both cases:

```js
const ReadTexture = new ShaderSnippet(({ version }) => `
  vec4 applyCamera(sampler2D img, vec2 coord) {
    return ${version === 300
      ? 'texture(img, coord)'
      : 'texture2D(img, coord)'
    };
  }
`, {
  extensions: ({ version }) => [], // return a string of extension names here
})
```

When you build a graph, you can specify a version and see what extensions it requires:

```js
const shader = new ShaderGraph({ version: 300 })
// ...
const { vert, frag, extensions } = shader.build()
```
