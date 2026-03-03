import re
import sys
import subprocess
from pathlib import Path
from typing import Dict, List, Optional
from models import (
    TestReport,
    TestCaseDefinition,
    TestCaseType,
    UnexecutedReason,
    UnexecutedReasonCode,
    CategoryReport,
    TestCaseReport,
    TestResult,
)


def parse_test_file(path: Path) -> Optional[TestCaseDefinition]:
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()

    description = None
    category = None
    c_codes = []
    i_codes = []
    points = 1

    source_lines = []
    in_source = False

    for line in lines:
        if in_source:
            source_lines.append(line)
            continue

        if line.startswith("***"):
            description = line[3:].strip()
        elif line.startswith("+++"):
            category = line[3:].strip()
        elif line.startswith("!C!"):
            c_codes.append(int(line[3:].strip()))
        elif line.startswith("!I!"):
            i_codes.append(int(line[3:].strip()))
        elif line.startswith(">>>"):
            points = int(line[3:].strip())
        elif line.strip() == "":
            in_source = True

    if not category:
        return None

    test_type = None
    if c_codes and not i_codes:
        test_type = TestCaseType.PARSE_ONLY
    elif i_codes and not c_codes:
        test_type = TestCaseType.EXECUTE_ONLY
    elif c_codes and i_codes:
        test_type = TestCaseType.COMBINED
    else:
        return None

    in_file = path.with_suffix(".in")
    out_file = path.with_suffix(".out")

    return TestCaseDefinition(
        name=path.stem,
        test_type=test_type,
        description=description,
        category=category,
        points=points,
        test_source_path=path,
        stdin_file=in_file if in_file.exists() else None,
        expected_stdout_file=out_file if out_file.exists() else None,
        expected_parser_exit_codes=c_codes if c_codes else None,
        expected_interpreter_exit_codes=i_codes if i_codes else None,
    )


def execute_tests(args, tests: List[TestCaseDefinition]) -> TestReport:
    discovered = []
    unexecuted = {}
    results = {}

    import json

    for t in tests:
        # Check filters
        name = t.name
        cat = t.category

        include_list = args.include or []
        include_cats = args.include_category or []
        include_tests = args.include_test or []
        exclude_list = args.exclude or []
        exclude_cats = args.exclude_category or []
        exclude_tests = args.exclude_test or []

        def matches(val, patterns):
            if args.regex_filters:
                return any(re.search(p, val) for p in patterns)
            return val in patterns

        is_included = True
        if include_list or include_cats or include_tests:
            is_included = False
            if matches(name, include_list) or matches(cat, include_list):
                is_included = True
            if matches(cat, include_cats):
                is_included = True
            if matches(name, include_tests):
                is_included = True

        is_excluded = False
        if matches(name, exclude_list) or matches(cat, exclude_list):
            is_excluded = True
        if matches(cat, exclude_cats):
            is_excluded = True
        if matches(name, exclude_tests):
            is_excluded = True

        if not is_included or is_excluded:
            unexecuted[name] = UnexecutedReason(
                code=UnexecutedReasonCode.FILTERED_OUT, message="Filtered out"
            )
            continue

        if args.dry_run:
            continue

        discovered.append(t)

        # execution logic
        parser_rc = None
        parser_out = None
        parser_err = None
        int_rc = None
        int_out = None
        int_err = None
        diff_out = None
        res_status = TestResult.PASSED

        source = ""
        in_source = False
        for line in t.test_source_path.read_text(encoding="utf-8").splitlines():
            if in_source:
                source += line + "\n"
            if line.strip() == "":
                in_source = True

        xml_source = source

        if t.test_type in [TestCaseType.PARSE_ONLY, TestCaseType.COMBINED]:
            try:
                proc = subprocess.run(
                    ["/tmp/sol26/sol2xml/.venv/bin/python", "/tmp/sol26/sol2xml/sol_to_xml.py"],
                    input=source,
                    text=True,
                    capture_output=True,
                    timeout=5,
                )
                parser_rc = proc.returncode
                parser_out = proc.stdout
                parser_err = proc.stderr
                xml_source = parser_out
            except Exception as e:
                unexecuted[name] = UnexecutedReason(
                    code=UnexecutedReasonCode.CANNOT_EXECUTE, message=str(e)
                )
                discovered.pop()
                continue

            if (
                t.expected_parser_exit_codes is not None
                and parser_rc not in t.expected_parser_exit_codes
            ):
                res_status = TestResult.UNEXPECTED_PARSER_EXIT_CODE

        if res_status == TestResult.PASSED and t.test_type in [
            TestCaseType.EXECUTE_ONLY,
            TestCaseType.COMBINED,
        ]:
            try:
                # Write xml to temp
                tmp_xml = Path("/tmp/sol26/python-tester/tests/temp.xml")
                tmp_xml.write_text(xml_source, encoding="utf-8")

                cmd = [
                    "node",
                    "/tmp/sol26/typescript-int/dist/solint.js",
                    "--source",
                    str(tmp_xml),
                ]
                if t.stdin_file:
                    cmd.extend(["--input", str(t.stdin_file)])

                proc = subprocess.run(cmd, text=True, capture_output=True, timeout=5)
                int_rc = proc.returncode
                int_out = proc.stdout
                int_err = proc.stderr
            except Exception as e:
                unexecuted[name] = UnexecutedReason(
                    code=UnexecutedReasonCode.CANNOT_EXECUTE, message=str(e)
                )
                discovered.pop()
                continue

            if (
                t.expected_interpreter_exit_codes is not None
                and int_rc not in t.expected_interpreter_exit_codes
            ):
                res_status = TestResult.UNEXPECTED_INTERPRETER_EXIT_CODE
            elif t.expected_stdout_file:
                # diff
                tmp_out = Path("/tmp/sol26/python-tester/tests/temp.out")
                tmp_out.write_text(int_out, encoding="utf-8")
                proc = subprocess.run(
                    ["diff", str(t.expected_stdout_file), str(tmp_out)],
                    text=True,
                    capture_output=True,
                )
                if proc.returncode != 0:
                    diff_out = proc.stdout
                    res_status = TestResult.INTERPRETER_RESULT_DIFFERS

        if cat not in results:
            results[cat] = CategoryReport(total_points=0, passed_points=0, test_results={})

        results[cat].total_points += t.points
        if res_status == TestResult.PASSED:
            results[cat].passed_points += t.points

        results[cat].test_results[name] = TestCaseReport(
            result=res_status,
            parser_exit_code=parser_rc,
            interpreter_exit_code=int_rc,
            parser_stdout=parser_out,
            parser_stderr=parser_err,
            interpreter_stdout=int_out,
            interpreter_stderr=int_err,
            diff_output=diff_out,
        )

    return TestReport(
        discovered_test_cases=discovered,
        unexecuted=unexecuted,
        results=results if results else None,
    )


def main_execution(args):
    source_dir = args.tests_dir
    files = list(source_dir.rglob("*.test")) if args.recursive else list(source_dir.glob("*.test"))

    tests = []
    unexecuted = {}

    for f in files:
        try:
            t = parse_test_file(f)
            if t:
                tests.append(t)
            else:
                unexecuted[f.stem] = UnexecutedReason(
                    code=UnexecutedReasonCode.MALFORMED_TEST_CASE_FILE
                )
        except Exception as e:
            unexecuted[f.stem] = UnexecutedReason(
                code=UnexecutedReasonCode.MALFORMED_TEST_CASE_FILE, message=str(e)
            )

    report = execute_tests(args, tests)
    for k, v in unexecuted.items():
        if k not in report.unexecuted:
            report.unexecuted[k] = v

    return report
