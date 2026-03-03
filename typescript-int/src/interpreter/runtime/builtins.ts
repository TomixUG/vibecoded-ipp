import { ErrorCode } from "../error_codes.js";
import { InterpreterError } from "../exceptions.js";
import type { Environment } from "./environment.js";
import { SolClass, SolObject, SolBuiltinMethod } from "./objects.js";

export class GlobalContext {
  public ObjectClass!: SolClass;
  public NilClass!: SolClass;
  public IntegerClass!: SolClass;
  public StringClass!: SolClass;
  public BlockClass!: SolClass;
  public TrueClass!: SolClass;
  public FalseClass!: SolClass;

  public nilObject!: SolObject;
  public trueObject!: SolObject;
  public falseObject!: SolObject;

  public allClasses: Map<string, SolClass> = new Map();
  public inputLines: string[] = [];
  public currentLineIndex: number = 0;

  // We can also define instances of primitive singletons
  public createInteger(value: number): SolObject {
    const obj = new SolObject(this.IntegerClass);
    obj.internalValue = value;
    return obj;
  }

  public createString(value: string): SolObject {
    const obj = new SolObject(this.StringClass);
    obj.internalValue = value;
    return obj;
  }
}

export const globalCtx = new GlobalContext();

export function getArg(args: SolObject[], index: number): SolObject {
  const arg = args[index];
  if (arg === undefined) throw new InterpreterError(ErrorCode.INT_OTHER, "Missing argument");
  return arg;
}

function defineMethod(
  cls: SolClass,
  selector: string,
  arity: number,
  handler: (receiver: SolObject, args: SolObject[], env: Environment) => SolObject
) {
  cls.methods.set(selector, new SolBuiltinMethod(selector, arity, handler));
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
function expectInternal<T>(obj: SolObject, typeName: string): T {
  if (obj.internalValue === undefined) {
    throw new InterpreterError(ErrorCode.INT_OTHER, `Expected internal value for ${typeName}`);
  }
  return obj.internalValue as T;
}

export function initializeBuiltins() {
  const ObjectClass = new SolClass("Object");
  const NilClass = new SolClass("Nil", ObjectClass);
  const IntegerClass = new SolClass("Integer", ObjectClass);
  const StringClass = new SolClass("String", ObjectClass);
  const BlockClass = new SolClass("Block", ObjectClass);
  const TrueClass = new SolClass("True", ObjectClass);
  const FalseClass = new SolClass("False", ObjectClass);

  globalCtx.ObjectClass = ObjectClass;
  globalCtx.NilClass = NilClass;
  globalCtx.IntegerClass = IntegerClass;
  globalCtx.StringClass = StringClass;
  globalCtx.BlockClass = BlockClass;
  globalCtx.TrueClass = TrueClass;
  globalCtx.FalseClass = FalseClass;

  [ObjectClass, NilClass, IntegerClass, StringClass, BlockClass, TrueClass, FalseClass].forEach(
    (c) => {
      globalCtx.allClasses.set(c.name, c);
    }
  );

  globalCtx.nilObject = new SolObject(NilClass);
  globalCtx.trueObject = new SolObject(TrueClass);
  globalCtx.falseObject = new SolObject(FalseClass);

  // Object
  defineMethod(ObjectClass, "identicalTo:", 1, (receiver, args) => {
    return receiver === getArg(args, 0) ? globalCtx.trueObject : globalCtx.falseObject;
  });
  defineMethod(ObjectClass, "equalTo:", 1, (receiver, args) => {
    if (receiver.internalValue === undefined && getArg(args, 0).internalValue === undefined) {
      return receiver === getArg(args, 0) ? globalCtx.trueObject : globalCtx.falseObject;
    }
    return receiver.internalValue === getArg(args, 0).internalValue
      ? globalCtx.trueObject
      : globalCtx.falseObject;
  });
  defineMethod(ObjectClass, "asString", 0, () => globalCtx.createString(""));

  const typeChecks = ["isNumber", "isString", "isBlock", "isNil", "isBoolean"];
  for (const check of typeChecks) {
    defineMethod(ObjectClass, check, 0, () => globalCtx.falseObject);
  }

  // Nil
  defineMethod(NilClass, "asString", 0, () => globalCtx.createString("nil"));
  defineMethod(NilClass, "isNil", 0, () => globalCtx.trueObject);

  // Integer
  defineMethod(IntegerClass, "isNumber", 0, () => globalCtx.trueObject);
  defineMethod(IntegerClass, "equalTo:", 1, (receiver, args) => {
    return receiver.internalValue === getArg(args, 0).internalValue
      ? globalCtx.trueObject
      : globalCtx.falseObject;
  });
  defineMethod(IntegerClass, "greaterThan:", 1, (receiver, args) => {
    const a = expectInternal<number>(receiver, "Integer");
    const b = expectInternal<number>(getArg(args, 0), "Integer"); // Spec: argument could be anything? If invalid, return... wait spec says INT_OTHER or INT_DNU? Wait, if we use internal value we should just throw if no internal value. Actually, wait. Spec says "Standardní numerické operace". If it's not a number, fail with 52 INT_OTHER probably, or 53. Let's use 52 for wrong operand types (spec says 52 is e.g. wrong operand types).
    if (getArg(args, 0).internalValue === undefined)
      throw new InterpreterError(ErrorCode.INT_OTHER, "Argument must be an Integer");
    return a > b ? globalCtx.trueObject : globalCtx.falseObject;
  });
  defineMethod(IntegerClass, "plus:", 1, (receiver, args) => {
    if (getArg(args, 0).internalValue === undefined)
      throw new InterpreterError(ErrorCode.INT_OTHER, "Argument must be an Integer");
    return globalCtx.createInteger(
      expectInternal<number>(receiver, "Integer") + expectInternal<number>(getArg(args, 0), "Integer")
    );
  });
  defineMethod(IntegerClass, "minus:", 1, (receiver, args) => {
    if (getArg(args, 0).internalValue === undefined)
      throw new InterpreterError(ErrorCode.INT_OTHER, "Argument must be an Integer");
    return globalCtx.createInteger(
      expectInternal<number>(receiver, "Integer") - expectInternal<number>(getArg(args, 0), "Integer")
    );
  });
  defineMethod(IntegerClass, "multiplyBy:", 1, (receiver, args) => {
    if (getArg(args, 0).internalValue === undefined)
      throw new InterpreterError(ErrorCode.INT_OTHER, "Argument must be an Integer");
    return globalCtx.createInteger(
      expectInternal<number>(receiver, "Integer") * expectInternal<number>(getArg(args, 0), "Integer")
    );
  });
  defineMethod(IntegerClass, "divBy:", 1, (receiver, args) => {
    if (getArg(args, 0).internalValue === undefined)
      throw new InterpreterError(ErrorCode.INT_OTHER, "Argument must be an Integer");
    const a = expectInternal<number>(receiver, "Integer");
    const b = expectInternal<number>(getArg(args, 0), "Integer");
    if (b === 0) throw new InterpreterError(ErrorCode.INT_INVALID_ARG, "Division by zero");
    return globalCtx.createInteger(Math.trunc(a / b));
  });
  defineMethod(IntegerClass, "asString", 0, (receiver) => {
    return globalCtx.createString(expectInternal<number>(receiver, "Integer").toString());
  });
  defineMethod(IntegerClass, "asInteger", 0, (receiver) => receiver);
  defineMethod(IntegerClass, "timesRepeat:", 1, () => {
    throw new Error("timesRepeat: handled natively in evaluator");
  });

  // String
  defineMethod(StringClass, "isString", 0, () => globalCtx.trueObject);
  defineMethod(StringClass, "print", 0, (receiver) => {
    process.stdout.write(expectInternal<string>(receiver, "String"));
    return receiver;
  });
  defineMethod(StringClass, "equalTo:", 1, (receiver, args) => {
    return receiver.internalValue === getArg(args, 0).internalValue
      ? globalCtx.trueObject
      : globalCtx.falseObject;
  });
  defineMethod(StringClass, "asString", 0, (receiver) => receiver);
  defineMethod(StringClass, "asInteger", 0, (receiver) => {
    const str = expectInternal<string>(receiver, "String");
    const num = Number(str);
    if (!isNaN(num) && Number.isInteger(num)) {
      return globalCtx.createInteger(num);
    }
    return globalCtx.nilObject;
  });
  defineMethod(StringClass, "concatenateWith:", 1, (receiver, args) => {
    if (!isSubclass(getArg(args, 0).solClass, StringClass)) return globalCtx.nilObject;
    return globalCtx.createString(
      expectInternal<string>(receiver, "String") + expectInternal<string>(getArg(args, 0), "String")
    );
  });
  defineMethod(StringClass, "startsWith:endsBefore:", 2, (receiver, args) => {
    if (
      getArg(args, 0).internalValue === undefined ||
      typeof getArg(args, 0).internalValue !== "number" ||
      getArg(args, 1).internalValue === undefined ||
      typeof getArg(args, 1).internalValue !== "number"
    ) {
      return globalCtx.nilObject;
    }
    const start = getArg(args, 0).internalValue as number;
    const end = getArg(args, 1).internalValue as number;
    if (start <= 0 || end <= 0) return globalCtx.nilObject;
    if (end - start <= 0) return globalCtx.createString("");
    const str = expectInternal<string>(receiver, "String");
    return globalCtx.createString(str.substring(start - 1, end - 1));
  });
  defineMethod(StringClass, "length", 0, (receiver) => {
    return globalCtx.createInteger(expectInternal<string>(receiver, "String").length);
  });

  // True & False
  defineMethod(TrueClass, "isBoolean", 0, () => globalCtx.trueObject);
  defineMethod(FalseClass, "isBoolean", 0, () => globalCtx.trueObject);

  defineMethod(TrueClass, "asString", 0, () => globalCtx.createString("true"));
  defineMethod(FalseClass, "asString", 0, () => globalCtx.createString("false"));

  defineMethod(TrueClass, "not", 0, () => globalCtx.falseObject);
  defineMethod(FalseClass, "not", 0, () => globalCtx.trueObject);

  defineMethod(TrueClass, "and:", 1, () => {
    throw new Error("handled natively in evaluator");
  });
  defineMethod(FalseClass, "and:", 1, () => globalCtx.falseObject);

  defineMethod(TrueClass, "or:", 1, () => globalCtx.trueObject);
  defineMethod(FalseClass, "or:", 1, () => {
    throw new Error("handled natively in evaluator");
  });

  defineMethod(TrueClass, "ifTrue:ifFalse:", 2, () => {
    throw new Error("handled natively in evaluator");
  });
  defineMethod(FalseClass, "ifTrue:ifFalse:", 2, () => {
    throw new Error("handled natively in evaluator");
  });

  // Block
  defineMethod(BlockClass, "isBlock", 0, () => globalCtx.trueObject);
  defineMethod(BlockClass, "whileTrue:", 1, () => {
    throw new Error("handled natively in evaluator");
  });
}

export function isSubclass(cls: SolClass, parent: SolClass): boolean {
  let current: SolClass | null = cls;
  while (current !== null) {
    if (current === parent) return true;
    current = current.parent;
  }
  return false;
}
