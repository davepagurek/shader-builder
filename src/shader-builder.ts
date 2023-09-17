import { DeclarationNode, DeclarationStatementNode, DeclaratorListNode, FunctionNode, IdentifierNode, KeywordNode, Program, StructDeclarationNode } from '@shaderfrog/glsl-parser/ast'
import { parse } from '@shaderfrog/glsl-parser/parser/parser'
import { Scope } from '@shaderfrog/glsl-parser/parser/scope'

interface ShaderContext {
  type: 'vert' | 'frag'
  version: 100 | 300
}

interface ShaderGraphNode {
  reference(ctx: ShaderContext): string
  declaration(ctx: ShaderContext): string
  header(ctx: ShaderContext): string
  dependsUpon(ctx: ShaderContext): ShaderGraphNode[]
  extensions(ctx: ShaderContext): string[]

  varyingProxy?: ShaderVarying
}

export class ShaderSnippet implements ShaderGraphNode {
  program: Program
  globalScope: Scope
  mainFunctionName: string
  inputTypes: { [name: string]: string }
  inputs: string[]

  outputType: string
  outputProperties: { [name: string]: string } | null
  makeSnippet: (ctx: ShaderContext) => string
  extensions: (ctx: ShaderContext) => string[]

  uses: number = 0

  constructor(
    snippet: string | ((ctx?: ShaderContext) => string),
    {
      mainFunction: rawMainFunction,
      extensions = () => [],
    }: {
      mainFunction?: string
      extensions?: (ctx: ShaderContext) => string[]
    } = {}
  ) {
    if (snippet instanceof Function) {
      this.makeSnippet = snippet
    } else {
      this.makeSnippet = () => snippet
    }
    this.extensions = extensions
    this.program = parse(snippet instanceof Function ? snippet() : snippet)
    this.globalScope = this.program.scopes.find((scope) => scope?.name === 'global')!
    const mainFunctionName = rawMainFunction ?? last(Object.keys(this.globalScope.functions))
    const mainFunctionSignatures = this.globalScope.functions[mainFunctionName]
    const mainFunction = last(Object.values(mainFunctionSignatures))
    this.mainFunctionName = mainFunction.declaration!.prototype.header.name.identifier
    this.inputs = mainFunction.declaration!.prototype.parameters?.map((param) => param.identifier.identifier) ?? []
    this.inputTypes = {}
    mainFunction.parameterTypes.forEach((typeName, i) => {
      this.inputTypes[this.inputs[i]] = typeName
    })

    this.outputType = mainFunction.returnType
    const outputTypeNode = this.globalScope.types[this.outputType]
    if (outputTypeNode) {
      const outputProperties: { [name: string]: string } = {}
      const typeDeclaration = this.program.program.find(
        (node) => (node as any).declaration?.specified_type?.specifier?.specifier?.typeName?.identifier === this.outputType
      )
      if (!typeDeclaration) {
        throw new Error(`Couldn't find the type declaration for the return type ${this.outputType}!`)
      }
      for (const declaration of (typeDeclaration as any).declaration.specified_type.specifier.specifier.declarations as StructDeclarationNode[]) {
        const typeName = (declaration.declaration.specified_type.specifier.specifier as KeywordNode).token
        for (const propNode of declaration.declaration.declarations) {
          outputProperties[propNode.identifier.identifier] = typeName
        }
      }
      this.outputProperties = outputProperties
    } else {
      this.outputProperties = null
    }
  }

  reference() {
    return ''
  }

  declaration() {
    return ''
  }

  dependsUpon() {
    return []
  }

  header(ctx: ShaderContext) {
    // TODO: rename types
    return this.makeSnippet(ctx)
  }

  instantiate() {
    return new ShaderSnippetInstance(this)
  }
}

interface ShaderValue extends ShaderGraphNode {
  typeName(): string
  connections: Set<ShaderValue>
  addConnection(node: ShaderValue)
  removeConnection(node: ShaderValue)
  replaceWith(other: ShaderValue)
  insertBetween(before: ShaderValue, insert: ShaderValue)
}

abstract class BaseShaderValue implements ShaderValue {
  abstract reference(ctx: ShaderContext): string
  abstract header(ctx: ShaderContext): string
  abstract declaration(ctx: ShaderContext): string
  abstract extensions(ctx: ShaderContext): string[]
  abstract dependsUpon(ctx: ShaderContext): ShaderGraphNode[]
  abstract typeName(): string

  varyingProxy?: ShaderVarying

  connections = new Set<ShaderValue>()

  addConnection(node: ShaderValue) {
    this.connections.add(node)
  }

  removeConnection(node: ShaderValue) {
    this.connections.delete(node)
  }

  replaceWith(other: ShaderValue) {
    for (const connection of this.connections) {
      if (connection instanceof Inputtable) {
        connection.input = other
        other.addConnection(connection)
        this.removeConnection(connection)
      } else {
        throw new Error('Connection is not inputtable')
      }
    }
  }

  insertBetween(before: ShaderValue, insert: ShaderValue) {
    if (!(before instanceof Inputtable) || !(insert instanceof Inputtable)) {
      throw new Error('Connection is not inputtable')
    }
    console.log(this)
    console.log(before)
    if (before.input !== this) {
      throw new Error('Nodes are not connected')
    }
    insert.input = this
    before.input = insert
    insert.addConnection(before)
    this.removeConnection(before)
  }
}

export class ShaderSnippetInstance extends BaseShaderValue implements ShaderGraphNode {
  inputs: { [name: string]: ShaderSnippetInstanceInput }
  output: ShaderSnippetInstanceOutput | { [name: string]: ShaderSnippetInstanceOutput }
  id: string

  constructor(public snippet: ShaderSnippet) {
    super()
    this.id = `__${this.snippet.mainFunctionName}_out_${this.snippet.uses++}`
    this.inputs = {}
    for (const input of snippet.inputs) {
      this.inputs[input] = new ShaderSnippetInstanceInput(this, input)
    }
    if (this.snippet.outputProperties) {
      this.output = {}
      for (const prop in this.snippet.outputProperties) {
        this.output[prop] = new ShaderSnippetInstanceOutput(this, prop)
      }
    } else {
      this.output = new ShaderSnippetInstanceOutput(this, null)
    }
  }

  typeName() {
    return this.snippet.outputType
  }

  reference() {
    return this.id
  }

  declaration(ctx: ShaderContext) {
    return `${this.id} = ${this.snippet.mainFunctionName}(${
      this.snippet.inputs.map((key) => this.inputs[key].reference(ctx)).join(', ')
    });`
  }

  header() {
    return ''
  }

  extensions() {
    return []
  }

  dependsUpon(): ShaderGraphNode[] {
    if (!this.isComplete()) {
      throw new Error(
        `This snippet doesn't have complete inputs: ${
          Object.keys(this.inputs).filter((k) => !this.inputs[k].input).join(', ')
        }`
      )
    }
    return [this.snippet, ...Object.values(this.inputs)]
  }

  isComplete() {
    for (const input of Object.values(this.inputs)) {
      if (input.input === null) return false
    }
    return true
  }

  connect(property: string | null = null): ShaderSnippetInstanceOutput {
    if (property === null) {
      if (!(this.output instanceof ShaderSnippetInstanceOutput)) {
        throw new Error('Please pass a property name to connect(), since it is a struct')
      }
      return this.output
    } else {
      if (this.output instanceof ShaderSnippetInstanceOutput) {
        throw new Error('Cannot pass a property name to connect() with a single value output')
      }
      return this.output[property]
    }
  }

  connectTo(input: Inputtable) {
    return this.connect().to(input)
  }
}

export abstract class Inputtable extends BaseShaderValue implements ShaderGraphNode {
  _input: ShaderValue | null = null

  constructor() {
    super()
  }

  get input() {
    if (this._input === null) {
      throw new Error('Input is not connected!')
    }
    return this._input
  }
  set input(input: ShaderValue) {
    this._input = input
  }

  abstract typeName(): string

  attach(output: ShaderValue) {
    if (this.typeName() !== output.typeName()) {
      throw new Error(`Could not connect nodes: output type ${output.typeName()} does not match input type ${this.typeName()}`)
    }
    if (this._input) {
      this._input.removeConnection(this)
    }
    this._input = output
    output.addConnection(this)
  }
}

export class ShaderSnippetInstanceInput extends Inputtable implements ShaderGraphNode {
  constructor(public source: ShaderSnippetInstance, public property: string) {
    super()
  }

  reference(ctx: ShaderContext) {
    if (this.input === null) {
      throw new Error(`Input ${this.property} of ${this.source.reference()} is not connected!`)
    }
    return this.input.reference(ctx)
  }

  header() {
    return ''
  }

  declaration() {
    return ''
  }

  dependsUpon() {
    return [this.source, this.input]
  }

  typeName(): string {
    return this.source.snippet.inputTypes[this.property]
  }

  extensions() {
    return []
  }
}

export class DefaultShaderOutput extends Inputtable implements ShaderGraphNode {
  constructor(public type: string, public name: string) {
    super()
  }

  typeName() {
    return this.type
  }

  reference(_ctx: ShaderContext) {
    return this.name
  }

  declaration(ctx: ShaderContext) {
    return `${this.reference(ctx)} = ${this.input.reference(ctx)};`
  }

  header(_ctx: ShaderContext) {
    return ''
  }

  dependsUpon() {
    return [this.input]
  }

  extensions() {
    return []
  }
}

export class DefaultShaderInput extends BaseShaderValue implements ShaderValue {
  constructor(public type: string, public name: string) {
    super()
  }

  reference() {
    return this.name
  }

  declaration() {
    return ''
  }

  dependsUpon() {
    return []
  }

  typeName() {
    return this.type
  }

  header() {
    return ''
  }

  extensions() {
    return []
  }
}

export class ShaderAttribute extends BaseShaderValue implements ShaderValue {
  constructor(public type: string, public name: string) {
    super()
  }

  reference(ctx: ShaderContext) {
    if (ctx.type === 'frag') {
      throw new Error(`Can't reference attribute ${this.name} from a fragment shader. Please add a varying in between.`)
    }
    return this.name
  }

  declaration() {
    return ''
  }

  dependsUpon() {
    return []
  }

  header(ctx: ShaderContext) {
    const keyword = ctx.version === 300 ? 'in' : 'attribute'
    return `${keyword} ${this.type} ${this.name};`
  }

  typeName(): string {
    return this.type
  }

  connectTo(input: Inputtable) {
    return input.attach(this)
  }

  extensions() {
    return []
  }
}

export class ShaderVarying extends Inputtable implements ShaderValue {
  constructor(public type: string, public name: string) {
    super()
  }

  reference() {
    return this.name
  }

  declaration(ctx: ShaderContext) {
    if (ctx.type === 'vert') {
      return `${this.name} = ${this.input.reference(ctx)}`
    } else {
      return ''
    }
  }

  dependsUpon(ctx: ShaderContext) {
    if (ctx.type === 'vert') {
      return [this.input]
    } else {
      return []
    }
  }

  header(ctx: ShaderContext) {
    let keyword: string
    if (ctx.version === 300) {
      keyword = ctx.type === 'vert' ? 'out' : 'in'
    } else {
      keyword = 'varying'
    }
    return `${keyword} ${this.type} ${this.name};`
  }

  typeName(): string {
    return this.type
  }

  connectTo(input: Inputtable) {
    return input.attach(this)
  }

  extensions() {
    return []
  }
}

export class ShaderUniform extends BaseShaderValue implements ShaderValue {
  constructor(public type: string, public name: string) {
    super()
  }

  header() {
    return `uniform ${this.type} ${this.name};`
  }

  declaration() {
    return ''
  }

  reference() {
    return this.name
  }

  dependsUpon() {
    return []
  }

  typeName(): string {
    return this.type
  }

  connectTo(input: Inputtable) {
    return input.attach(this)
  }

  extensions() {
    return []
  }
}

export class ShaderSnippetInstanceOutput extends BaseShaderValue implements ShaderValue {
  constructor(public source: ShaderSnippetInstance, public property: string | null) {
    super()
  }

  reference() {
    if (this.property === null) {
      return this.source.reference()
    } else {
      return `${this.source.reference()}.${this.property}`
    }
  }

  declaration() {
    return ''
  }

  header() {
    return ''
  }

  dependsUpon() {
    return [this.source]
  }

  extensions() {
    return []
  }

  typeName() {
    if (this.property) {
      return this.source.snippet.outputProperties![this.property]
    } else {
      return this.source.snippet.outputType
    }
  }

  to(input: Inputtable) {
    input.attach(this)
  }
}

class DefaultShaderOutputColor extends DefaultShaderOutput {
  constructor() {
    super('vec4', 'gl_FragColor')
  }

  reference(ctx: ShaderContext) {
    return ctx.version === 100 ? 'gl_FragColor' : 'color'
  }

  header(ctx: ShaderContext) {
    return ctx.version === 100 ? '' : 'out vec4 color;'
  }
}

export type Precision = 'lowp' | 'mediump' | 'highp'
export class ShaderGraph {
  position = new DefaultShaderOutput('vec4', 'gl_Position')
  fragPosition = new DefaultShaderInput('vec4', 'gl_FragPosition')
  color = new DefaultShaderOutputColor()
  intPrecision: Precision
  floatPrecision: Precision
  version: 100 | 300

  constructor({
    intPrecision = 'highp',
    floatPrecision = 'highp',
    version = 100,
  }: {
    intPrecision?: Precision
    floatPrecision?: Precision
    version?: 100 | 300
  } = {}) {
    this.intPrecision = intPrecision
    this.floatPrecision = floatPrecision
    this.version = version
  }

  build() {
    const frag = this.buildShader([this.color], { type: 'frag', version: this.version })
    const vert = this.buildShader(
      [
        this.position,
        ...[...frag.nodes].filter((node) => node instanceof ShaderVarying),
      ],
      { type: 'vert', version: this.version },
    )
    const extensions = new Set<string>()
    for (const group of [vert.nodes, frag.nodes]) {
      const ctx: ShaderContext = { version: this.version, type: group === vert.nodes ? 'vert' : 'frag' }
      for (const node of group) {
        for (const ext of node.extensions(ctx)) {
          extensions.add(ext)
        }
      }
    }
    return { vert, frag, extensions }
  }

  private buildShader(roots: ShaderGraphNode[], ctx: ShaderContext) {
    const nodes = new Set<ShaderGraphNode>()
    const orderedNodes: ShaderGraphNode[] = []
    const mainSource: string[] = []
    const headerSource: string[] = [`precision ${this.intPrecision} int;`, `precision ${this.floatPrecision} float;`]
    if (ctx.version === 300) {
      headerSource.unshift('#version 300 es')
    }

    function processNode(node: ShaderGraphNode) {
      if (nodes.has(node)) return
      nodes.add(node)
      orderedNodes.unshift(node)
      for (const dependency of node.dependsUpon(ctx)) {
        if (ctx.type === 'frag' && dependency instanceof ShaderAttribute) {
          if (!dependency.varyingProxy) {
            dependency.varyingProxy = new ShaderVarying(dependency.type, `${dependency.name}_varying_proxy`)
          }
          (dependency as ShaderValue).insertBetween(node as ShaderValue, dependency.varyingProxy)
          processNode(dependency.varyingProxy)
        } else {
          processNode(dependency)
        }
      }
    }
    for (const root of roots) {
      processNode(root)
    }

    for (const node of orderedNodes) {
      const header = node.header(ctx)
      if (header) {
        headerSource.push(header)
      }
      const declaration = node.declaration(ctx)
      if (declaration) {
        mainSource.push(declaration)
      }
    }
    const src = `${headerSource.join('\n')}
void main() {
${mainSource.join('\n')}
}`
    return { nodes, src }
  }
}

function last<T>(values: Array<T>): T {
  return values[values.length - 1]
}
