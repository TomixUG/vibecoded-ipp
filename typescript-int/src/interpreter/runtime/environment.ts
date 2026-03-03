import { ErrorCode } from "../error_codes.js";
import { InterpreterError } from "../exceptions.js";
import type { SolObject } from "./objects.js";

export class Environment {
  private readonly variables = new Map<string, SolObject>();
  private readonly readonlyVars = new Set<string>();

  public constructor(public readonly parent: Environment | null = null) {}

  public defineVariable(name: string, value: SolObject, isReadonly = false): void {
    if (this.readonlyVars.has(name)) {
      throw new InterpreterError(
        ErrorCode.SEM_COLLISION,
        `Cannot reassign readonly variable (parameter) '${name}'`
      );
    }
    this.variables.set(name, value);
    if (isReadonly) {
      this.readonlyVars.add(name);
    }
  }

  public assignVariable(name: string, value: SolObject): void {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let current: Environment | null = this;
    let foundEnv: Environment | null = null;

    while (current !== null) {
      if (current.variables.has(name)) {
        foundEnv = current;
        break;
      }
      current = current.parent;
    }

    if (foundEnv !== null) {
      if (foundEnv.readonlyVars.has(name)) {
        throw new InterpreterError(
          ErrorCode.SEM_COLLISION,
          `Cannot assign to readonly variable '${name}'`
        );
      }
      foundEnv.variables.set(name, value);
    } else {
      // Create new local var
      this.variables.set(name, value);
    }
  }

  public getVariable(name: string): SolObject {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let current: Environment | null = this;
    while (current !== null) {
      const value = current.variables.get(name);
      if (value !== undefined) {
        return value;
      }
      current = current.parent;
    }
    throw new InterpreterError(ErrorCode.SEM_UNDEF, `Undefined variable '${name}'`);
  }
}
