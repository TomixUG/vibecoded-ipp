import { readFileSync } from "node:fs";
import type { Readable } from "node:stream";
import { ErrorCode } from "./error_codes.js";
import { InterpreterError } from "./exceptions.js";
import {
  InvalidXmlError,
  ModelValidationError,
  parseProgramXml,
  type Program,
} from "./input_model.js";
import { getLogger } from "./logging.js";
import { Evaluator } from "./runtime/evaluator.js";
import { globalCtx, initializeBuiltins } from "./runtime/builtins.js";
import { SolAstMethod, SolClass } from "./runtime/objects.js";
import { Environment } from "./runtime/environment.js";

const logger = getLogger("interpreter");

export class Interpreter {
  public currentProgram: Program | null = null;

  public loadProgram(sourceFilePath: string): void {
    logger.info("Opening source file:", sourceFilePath);
    try {
      const sourceText = readFileSync(sourceFilePath, "utf8");
      this.currentProgram = parseProgramXml(sourceText);
    } catch (error) {
      if (error instanceof InvalidXmlError) {
        throw new InterpreterError(ErrorCode.INT_XML, "Error parsing input XML");
      }
      if (error instanceof ModelValidationError) {
        throw new InterpreterError(ErrorCode.INT_STRUCTURE, "Invalid SOL-XML structure");
      }
      throw error;
    }
  }

  // eslint-disable-next-line complexity
  public execute(inputIo: Readable): void {
    logger.info("Executing program");
    void inputIo; // Bypass inputIo since we need synchronous read

    let inputLines: string[] = [];
    let inputPath: string | null = null;
    const argv = process.argv;
    for (let i = 0; i < argv.length; i++) {
      if ((argv[i] === "-i" || argv[i] === "--input") && i + 1 < argv.length) {
        inputPath = argv[i + 1] as string;
      }
    }

    if (inputPath) {
      const inputText = readFileSync(inputPath, "utf8");
      inputLines = inputText.split(/\r?\n/);
    }

    if (inputLines.length > 0 && inputLines[inputLines.length - 1] === "") {
      inputLines.pop();
    }

    initializeBuiltins();
    globalCtx.inputLines = inputLines;
    globalCtx.currentLineIndex = 0;

    if (!this.currentProgram) {
      throw new Error("No program loaded");
    }

    // 1. Create all class skeletons
    for (const clsDef of this.currentProgram.classes) {
      if (globalCtx.allClasses.has(clsDef.name)) {
        throw new InterpreterError(ErrorCode.SEM_ERROR, `Class redefined: ${clsDef.name}`);
      }
      const solCls = new SolClass(clsDef.name);
      globalCtx.allClasses.set(clsDef.name, solCls);
    }

    // 2. Link parents and register methods
    for (const clsDef of this.currentProgram.classes) {
      const solCls = globalCtx.allClasses.get(clsDef.name);
      if (!solCls) {
         throw new InterpreterError(ErrorCode.SEM_UNDEF, `Undefined class: ${clsDef.name}`);
      }
      const parentCls = globalCtx.allClasses.get(clsDef.parent);
      if (!parentCls) {
        throw new InterpreterError(
          ErrorCode.SEM_UNDEF,
          `Undefined parent class: ${clsDef.parent}`
        );
      }
      // Cast away readonly to set parent
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (solCls as any).parent = parentCls;

      for (const methDef of clsDef.methods) {
        const expectedArity =
          methDef.selector === "value"
            ? 0
            : methDef.selector.includes(":")
              ? methDef.selector.split(":").length - 1
              : 0;

        // Let's not fail on selector names without colons if they have parameters, but spec says:
        // "Vyjma bezparametrického selektoru se bezprostředně za každým identifikátorem píše dvojtečka, počet dvojteček selektoru tak udává počet argumentů zprávy"
        if (methDef.block.arity !== expectedArity) {
          throw new InterpreterError(
            ErrorCode.SEM_ARITY,
            `Arity mismatch for method ${methDef.selector}`
          );
        }

        if (solCls.methods.has(methDef.selector)) {
          throw new InterpreterError(ErrorCode.SEM_ERROR, `Method redefined: ${methDef.selector}`);
        }

        solCls.methods.set(
          methDef.selector,
          new SolAstMethod(methDef.selector, methDef.block.arity, methDef.block, solCls)
        );
      }
    }

    const mainCls = globalCtx.allClasses.get("Main");
    if (!mainCls) {
      throw new InterpreterError(ErrorCode.SEM_MAIN, "Missing Main class");
    }
    const runMeth = mainCls.methods.get("run");
    if (!runMeth || runMeth.arity !== 0) {
      throw new InterpreterError(ErrorCode.SEM_MAIN, "Missing Main.run or bad arity");
    }

    // Execute Main.new.run
    const evaluator = new Evaluator();
    const globalEnv = new Environment(); // Just empty top env

    const initClassExpr = {
      literal: null,
      var: null,
      block: null,
      send: {
        selector: "new",
        receiver: {
          literal: { class_id: "class", value: "Main" },
          var: null,
          block: null,
          send: null,
        },
        args: [],
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
    const mainInstance = evaluator.evalExpr(initClassExpr as any, globalEnv);
    const runExpr = {
      literal: null,
      var: null,
      block: null,
      send: {
        selector: "run",
        receiver: { literal: null, var: { name: "mainInstance" }, block: null, send: null },
        args: [],
      },
    };
    globalEnv.assignVariable("mainInstance", mainInstance);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
    evaluator.evalExpr(runExpr as any, globalEnv);
  }
}
