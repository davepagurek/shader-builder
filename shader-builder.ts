import { DeclarationNode, DeclarationStatementNode, DeclaratorListNode, FunctionNode, IdentifierNode, KeywordNode, Program, StructDeclarationNode } from '@shaderfrog/glsl-parser/ast'
import { parse } from '@shaderfrog/glsl-parser/parser/parser'
import { Scope } from '@shaderfrog/glsl-parser/parser/scope'

class ShaderSnippet {
  program: Program
  globalScope: Scope
  mainFunctionName: string
  inputTypes: { [name: string]: string }
  inputs: string[]

  outputType: string
  outputProperties: { [name: string]: string } | null

  constructor(snippet: string, { mainFunction: rawMainFunction }: { mainFunction?: string } = {}) {
    this.program = parse(snippet)
    this.globalScope = this.program.scopes.find((scope) => scope.name === 'global')
    const mainFunctionName = rawMainFunction ?? last(Object.keys(this.globalScope.functions))
    const mainFunctionSignatures = this.globalScope.functions[mainFunctionName]
    const mainFunction = last(Object.values(mainFunctionSignatures))
    this.mainFunctionName = mainFunction.declaration!.prototype.header.name.identifier
    this.inputs = mainFunction.declaration!.prototype.parameters.map((param) => param.identifier.identifier)
    this.inputTypes = {}
    mainFunction.parameterTypes.forEach((typeName, i) => {
      this.inputTypes[this.inputs[i]] = typeName
    })

    this.outputType = mainFunction.returnType
    const outputTypeNode = this.globalScope.types[this.outputType]
    if (outputTypeNode) {
      this.outputProperties = {}
      const typeDeclaration = this.program.program.find(
        (node) => (node as any).declaration?.specified_type?.specifier?.specifier?.typeName?.identifier === this.outputType
      )
      if (!typeDeclaration) {
        throw new Error(`Couldn't find the type declaration for the return type ${this.outputType}!`)
      }
      for (const declaration of (typeDeclaration as any).declaration.specified_type.specifier.specifier.declarations as StructDeclarationNode[]) {
        const typeName = (declaration.declaration.specified_type.specifier.specifier as KeywordNode).token
        for (const propNode of declaration.declaration.declarations) {
          this.outputProperties[propNode.identifier.identifier] = typeName
        }
      }
    } else {
      this.outputProperties = null
    }
  }

  instantiate() {
    return new ShaderSnippetInstance(this)
  }
}

type Input = { node: ShaderSnippetInstance, output: string | null }

class ShaderSnippetInstance {
  inputs: { [name: string]: Input | null }
  constructor(public snippet: ShaderSnippet) {
    this.inputs = {}
    for (const input of snippet.inputs) {
      this.inputs[input] = null
    }
  }

  isComplete() {
    for (const key in this.inputs) {
      if (this.inputs[key] === null) return false
    }
    return true
  }

  connect(property: string | null = null): ShaderSnippetInstanceOutput {
    return new ShaderSnippetInstanceOutput(this, property)
  }
}

class ShaderSnippetInstanceInput {
  constructor(public source: ShaderSnippetInstance, public property: string) {}

  typeName(): string {
    return this.source.snippet.inputs[this.property]
  }

  attach(output: ShaderSnippetInstanceOutput) {
    if (this.typeName() !== output.typeName()) {
      throw new Error(`Could not connect nodes: output type ${output.typeName()} does not match input type ${this.typeName()}`)
    }
    this.source.inputs[this.property] = { node: output.source, output: output.property }
  }
}

class ShaderSnippetInstanceOutput {
  constructor(public source: ShaderSnippetInstance, public property: string | null) {}

  typeName() {
    if (this.property) {
      return this.source.snippet.outputProperties[this.property]
    } else {
      return this.source.snippet.outputType
    }
  }

  to(input: ShaderSnippetInstanceInput) {
    input.attach(this)
  }
}

function last<T>(values: Array<T>): T {
  return values[values.length - 1]
}
