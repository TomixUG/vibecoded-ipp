import { Block } from "../input_model.js";
import { Environment } from "./environment.js";

export abstract class SolMethod {
  public constructor(
    public readonly selector: string,
    public readonly arity: number
  ) {}
}

export class SolAstMethod extends SolMethod {
  public constructor(
    selector: string,
    arity: number,
    public readonly block: Block,
    public readonly definingClass: SolClass
  ) {
    super(selector, arity);
  }
}

export class SolBuiltinMethod extends SolMethod {
  public constructor(
    selector: string,
    arity: number,
    public readonly handler: (
      receiver: SolObject,
      args: SolObject[],
      env: Environment
    ) => SolObject
  ) {
    super(selector, arity);
  }
}

export class SolClass {
  public readonly methods: Map<string, SolMethod> = new Map();

  public constructor(
    public readonly name: string,
    public readonly parent: SolClass | null = null
  ) {}

  public lookupMethod(selector: string): SolMethod | undefined {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let current: SolClass | null = this;
    while (current !== null) {
      const method = current.methods.get(selector);
      if (method !== undefined) {
        return method;
      }
      current = current.parent;
    }
    return undefined;
  }
}

export class SolObject {
  public readonly instanceAttributes: Map<string, SolObject> = new Map();
  // Set by internal types
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public internalValue?: any;

  public constructor(public solClass: SolClass) {}

  public cloneInstanceAttributesFrom(other: SolObject): void {
    for (const [key, value] of other.instanceAttributes.entries()) {
      this.instanceAttributes.set(key, value);
    }
  }
}
