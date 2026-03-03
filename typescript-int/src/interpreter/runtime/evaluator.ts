import { Expr, Literal, Var, Send, Block as AstBlock, Assign } from "../input_model.js";
import { SolObject, SolClass, SolAstMethod, SolBuiltinMethod, SolMethod } from "./objects.js";
import { Environment } from "./environment.js";
import { globalCtx, isSubclass, getArg } from "./builtins.js";
import { ErrorCode } from "../error_codes.js";
import { InterpreterError } from "../exceptions.js";

export class SolClassObject extends SolObject {
  constructor(public readonly refClass: SolClass) {
    super(globalCtx.ObjectClass);
  }
}

export interface BlockInternal {
  astBlock: AstBlock;
  capturedEnv: Environment;
  selfObj: SolObject | null;
  superClass: SolClass | null; // The class where the block's surrounding method is defined
}

export class Evaluator {
  public evalExpr(expr: Expr, env: Environment): SolObject {
    if (expr.literal) return this.evalLiteral(expr.literal);
    if (expr.var) return this.evalVar(expr.var, env);
    if (expr.block) return this.evalBlockLiteral(expr.block, env);
    if (expr.send) return this.evalSend(expr.send, env);
    throw new Error("Empty expression");
  }

  private evalLiteral(literal: Literal): SolObject {
    switch (literal.class_id) {
      case "Integer": {
        const val = parseInt(literal.value, 10);
        return globalCtx.createInteger(val);
      }
      case "String": {
        const val = literal.value;
        // The AST should have XML entities resolved, but escape sequences like \n might be mapped to &#10; already.
        // Let's assume standard strings.
        return globalCtx.createString(val);
      }
      case "True":
        return globalCtx.trueObject;
      case "False":
        return globalCtx.falseObject;
      case "Nil":
        return globalCtx.nilObject;
      case "class": {
        const cls = globalCtx.allClasses.get(literal.value);
        if (!cls)
          throw new InterpreterError(ErrorCode.SEM_UNDEF, `Undefined class ${literal.value}`);
        return new SolClassObject(cls);
      }
      default:
        throw new Error(`Unknown literal class: ${literal.class_id}`);
    }
  }

  private evalVar(v: Var, env: Environment): SolObject {
    if (v.name === "self" || v.name === "super") {
      return env.getVariable(v.name);
    }
    if (v.name === "true") return globalCtx.trueObject;
    if (v.name === "false") return globalCtx.falseObject;
    if (v.name === "nil") return globalCtx.nilObject;

    return env.getVariable(v.name);
  }

  private evalBlockLiteral(astBlock: AstBlock, env: Environment): SolObject {
    const blockObj = new SolObject(globalCtx.BlockClass);
    let selfObj: SolObject | null = null;
    let superClass: SolClass | null = null;

    try {
      selfObj = env.getVariable("self");
    } catch {
      /* empty */
    }
    try {
      superClass = env.getVariable("superClassRef").internalValue as SolClass;
    } catch {
      /* empty */
    }

    blockObj.internalValue = {
      astBlock,
      capturedEnv: env,
      selfObj,
      superClass,
    } as BlockInternal;
    return blockObj;
  }

  // eslint-disable-next-line complexity
  private evalSend(send: Send, env: Environment): SolObject {
    const receiver = this.evalExpr(send.receiver, env);
    const args = send.args.map((a) => this.evalExpr(a.expr, env));

    // Handle Class Methods
    if (receiver instanceof SolClassObject) {
      const cls = receiver.refClass;
      if (send.selector === "new" && args.length === 0) {
        return this.instantiateClass(cls);
      }
      if (send.selector === "from:" && args.length === 1) {
        return this.instantiateFrom(cls, getArg(args, 0));
      }
      if (cls === globalCtx.StringClass && send.selector === "read" && args.length === 0) {
        if (globalCtx.currentLineIndex < globalCtx.inputLines.length) {
          const line = globalCtx.inputLines[globalCtx.currentLineIndex++];
          return globalCtx.createString(line as string);
        }
        return globalCtx.createString(""); // EOF behavior
      }
      throw new InterpreterError(
        ErrorCode.SEM_UNDEF,
        `Class ${cls.name} does not understand ${send.selector}`
      );
    }

    // Native short-circuit logic
    if (receiver.solClass === globalCtx.TrueClass) {
      if (send.selector === "and:" && args.length === 1) return this.invokeValue(getArg(args, 0), []);
      if (send.selector === "or:" && args.length === 1) return globalCtx.trueObject;
      if (send.selector === "ifTrue:ifFalse:" && args.length === 2)
        return this.invokeValue(getArg(args, 0), []);
    }
    if (receiver.solClass === globalCtx.FalseClass) {
      if (send.selector === "and:" && args.length === 1) return globalCtx.falseObject;
      if (send.selector === "or:" && args.length === 1) return this.invokeValue(getArg(args, 0), []);
      if (send.selector === "ifTrue:ifFalse:" && args.length === 2)
        return this.invokeValue(getArg(args, 1), []);
    }
    if (receiver.solClass === globalCtx.BlockClass) {
      if (send.selector === "whileTrue:" && args.length === 1) {
        let lastRes = globalCtx.nilObject;
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        while (true) {
          const cond = this.invokeValue(receiver, []);
          if (cond === globalCtx.trueObject) {
            lastRes = this.invokeValue(getArg(args, 0), []);
          } else if (cond === globalCtx.falseObject) {
            break;
          } else {
            throw new InterpreterError(
              ErrorCode.INT_OTHER,
              "whileTrue: receiver did not return boolean"
            );
          }
        }
        return lastRes;
      }
       
      if (send.selector.startsWith("value")) {
        const expectedArity = send.selector === "value" ? 0 : send.selector.split(":").length - 1;
        if (expectedArity !== args.length) {
          throw new InterpreterError(ErrorCode.INT_DNU, "Wrong arity for block value");
        }
        return this.invokeValue(receiver, args);
      }
    }
    if (receiver.solClass === globalCtx.IntegerClass) {
      if (send.selector === "timesRepeat:" && args.length === 1) {
        const n = receiver.internalValue as number;
        let lastRes = globalCtx.nilObject;
        for (let i = 1; i <= n; i++) {
          lastRes = this.invokeValue(getArg(args, 0), [globalCtx.createInteger(i)]);
        }
        return lastRes;
      }
    }

    // Is it a super send?
    let isSuper = false;
    if (send.receiver.var && send.receiver.var.name === "super") {
      isSuper = true;
    }

    // Normal Method Dispatch
    let method: SolMethod | undefined;
    let lookupClass: SolClass | null = null;
    if (isSuper) {
      // Find the class where this super call was authored
      let superClassRef: SolObject;
      try {
        superClassRef = env.getVariable("superClassRef");
      } catch {
        throw new InterpreterError(ErrorCode.INT_OTHER, "super used outside method");
      }
      const authoredIn = superClassRef.internalValue as SolClass;
      lookupClass = authoredIn.parent;
    } else {
      lookupClass = receiver.solClass;
    }

    if (lookupClass) {
      method = lookupClass.lookupMethod(send.selector);
    }

    if (method) {
      if (method.arity !== args.length) {
        throw new InterpreterError(ErrorCode.INT_DNU, "Arity mismatch in message send");
      }
      if (method instanceof SolBuiltinMethod) {
        return method.handler(receiver, args, env);
      } else if (method instanceof SolAstMethod) {
        return this.invokeAstMethod(receiver, method, args);
      }
    }

    // Instance Attribute access/creation
    if (send.selector.endsWith(":")) {
      // Potentially setter
      if (args.length !== 1) {
        throw new InterpreterError(
          ErrorCode.INT_DNU,
          `Method ${send.selector} not found and cannot be setter with arity ${String(args.length)}`
        );
      }
      const attrName = send.selector.slice(0, -1);
      // Check collision with 0-arity methods
      const checkClass: SolClass | null = isSuper ? lookupClass : receiver.solClass;
      if (checkClass && checkClass.lookupMethod(attrName) !== undefined) {
        throw new InterpreterError(
          ErrorCode.INT_INST_ATTR,
          `Cannot create attribute '${attrName}' colliding with method`
        );
      }
      receiver.instanceAttributes.set(attrName, getArg(args, 0));
      return receiver;
    } else {
      // Potentially getter
      if (args.length !== 0) {
        throw new InterpreterError(ErrorCode.INT_DNU, `Method ${send.selector} not found`);
      }
      const attrName = send.selector;
      const val = receiver.instanceAttributes.get(attrName);
      if (val !== undefined) {
        return val;
      }
    }

    throw new InterpreterError(ErrorCode.INT_DNU, `Message not understood: ${send.selector}`);
  }

  private invokeValue(blockObj: SolObject, args: SolObject[]): SolObject {
    if (blockObj.solClass !== globalCtx.BlockClass) {
      throw new InterpreterError(ErrorCode.INT_DNU, "Expected a Block");
    }
    const internal = blockObj.internalValue as BlockInternal;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!internal || !internal.astBlock) {
      throw new InterpreterError(ErrorCode.INT_OTHER, "Invalid block");
    }
    if (internal.astBlock.arity !== args.length) {
      throw new InterpreterError(ErrorCode.INT_DNU, "Wrong arity for block value"); // 51
    }

    const blockEnv = new Environment(internal.capturedEnv);
    for (let i = 0; i < args.length; i++) {
      const param = internal.astBlock.parameters[i];
      if (!param) throw new InterpreterError(ErrorCode.INT_OTHER, "Missing parameter");
      blockEnv.defineVariable(param.name, getArg(args, i), true);
    }

    // We do NOT inject self/super here. It was captured by capturedEnv!

    return this.execAssigns(internal.astBlock.assigns, blockEnv);
  }

  private invokeAstMethod(
    receiver: SolObject,
    method: SolAstMethod,
    args: SolObject[]
  ): SolObject {
    const methodEnv = new Environment(null); // Wait, method env has no parent except global things... actually it's top level.
    // Spec says: V každém bloku jsou navíc k dispozici objekty nil, true, false s globální viditelností.
    // They are handled in `evalVar`.

    methodEnv.defineVariable("self", receiver, true);
    methodEnv.defineVariable("super", receiver, true);

    const classRef = new SolObject(globalCtx.ObjectClass);
    classRef.internalValue = method.definingClass;
    methodEnv.defineVariable("superClassRef", classRef, true);

    for (let i = 0; i < args.length; i++) {
      const param = method.block.parameters[i];
      if (!param) throw new InterpreterError(ErrorCode.INT_OTHER, "Missing parameter");
      methodEnv.defineVariable(param.name, getArg(args, i), true);
    }

    return this.execAssigns(method.block.assigns, methodEnv);
  }

  private execAssigns(assigns: Assign[], env: Environment): SolObject {
    let lastVal = globalCtx.nilObject;
    for (const assign of assigns) {
      // Evaluate right side
      const val = this.evalExpr(assign.expr, env);
      if (assign.target.name === "_") {
        lastVal = val;
        continue;
      }
      env.assignVariable(assign.target.name, val);
      lastVal = val;
    }
    return lastVal;
  }

  private instantiateClass(cls: SolClass): SolObject {
    const obj = new SolObject(cls);
    if (cls === globalCtx.IntegerClass) obj.internalValue = 0;
    if (cls === globalCtx.StringClass) obj.internalValue = "";
    if (cls === globalCtx.BlockClass) {
      // Create empty block instance natively so `value` works on it
      obj.internalValue = {
        astBlock: { arity: 0, parameters: [], assigns: [] },
        capturedEnv: new Environment(),
        selfObj: null,
        superClass: null,
      } as BlockInternal;
    }
    return obj;
  }

  // eslint-disable-next-line complexity
  private instantiateFrom(cls: SolClass, source: SolObject): SolObject {
    if (
      cls === globalCtx.NilClass ||
      cls === globalCtx.TrueClass ||
      cls === globalCtx.FalseClass
    ) {
      // Singletons
      if (cls === globalCtx.NilClass) return globalCtx.nilObject;
      if (cls === globalCtx.TrueClass) return globalCtx.trueObject;
      if (cls === globalCtx.FalseClass) return globalCtx.falseObject;
    }
    const obj = new SolObject(cls);

    // interní atributy
    if (
      cls === globalCtx.IntegerClass ||
      cls === globalCtx.StringClass ||
      isSubclass(cls, globalCtx.IntegerClass) ||
      isSubclass(cls, globalCtx.StringClass)
    ) {
      if (source.internalValue === undefined) {
        throw new InterpreterError(
          ErrorCode.INT_INVALID_ARG,
          `Source object lacks internal value for from:`
        ); // 53
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      obj.internalValue = source.internalValue;
    }

    obj.cloneInstanceAttributesFrom(source);
    return obj;
  }
}
